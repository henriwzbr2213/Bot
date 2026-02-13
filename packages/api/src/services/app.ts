import { AppStatus, Region, Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../utils/prisma';
import { GcpService } from './gcp';
import { K8sService } from './k8s';
import { InlineBuildQueue } from '../types/worker';
import { provisionFreeTier } from '../provision/freeTier';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

type CreateInput = {
  ownerDiscordId: string;
  name: string;
  region: Region;
  plan: 'neurion-basic' | 'canary-premium';
  maxUploadMb: number;
  cpuLimit: string;
  maxHostedBots: number;
};

export class AppService {
  private gcp = new GcpService();
  private k8s = new K8sService();
  private buildQueue = new InlineBuildQueue(async (payload) => {
    await prisma.app.update({ where: { id: payload.appId }, data: { status: AppStatus.building } });
    await this.gcp.triggerCloudBuild({ appId: payload.appId, zipGsUrl: payload.zipGsUrl, image: payload.image });

    const app = await this.mustGet(payload.appId);

    await prisma.app.update({ where: { id: payload.appId }, data: { image: payload.image, status: AppStatus.deploying } });
    const namespace = `${env.K8S_NAMESPACE_PREFIX}${payload.ownerId}`;
    const deploymentName = `app-${payload.appId}`;

    await this.k8s.deployApp({
      appId: payload.appId,
      ownerId: payload.ownerId,
      image: payload.image,
      region: payload.region,
      namespace,
      deploymentName,
      cpuLimit: app.cpuLimit
    });

    await prisma.app.update({ where: { id: payload.appId }, data: { namespace, deploymentName, status: AppStatus.running } });
  });

  authDiscord(userId: string) { return Promise.resolve({ userId, token: `stub-${userId}` }); }

  async registerUser(data: { name: string; email: string; password: string }) {
    const email = data.email.trim().toLowerCase();

    // senha segura: mínimo 10 chars com maiúscula, minúscula, número e símbolo
    const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,}$/;
    if (!strongPassword.test(data.password)) {
      throw new Error('Senha fraca. Use ao menos 10 caracteres com maiúscula, minúscula, número e símbolo.');
    }

    let existing;
    try {
      existing = await prisma.user.findUnique({ where: { email } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientInitializationError) {
        throw new Error('Banco de dados indisponível no momento.');
      }
      throw error;
    }

    if (existing) throw new Error('Email já cadastrado.');

    const passwordHash = this.hashPassword(data.password);

    try {
      const user = await prisma.user.create({ data: { name: data.name, email, passwordHash } });
      return { id: user.id, name: user.name, email: user.email };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Error('Email já cadastrado.');
      }
      if (error instanceof Prisma.PrismaClientInitializationError) {
        throw new Error('Banco de dados indisponível no momento.');
      }
      throw error;
    }
  }

  async loginUser(data: { email: string; password: string }) {
    const email = data.email.trim().toLowerCase();
    let user;
    try {
      user = await prisma.user.findUnique({ where: { email } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientInitializationError) {
        throw new Error('Banco de dados indisponível no momento.');
      }
      throw error;
    }

    if (!user) throw new Error('Usuário não encontrado.');

    const ok = this.verifyPassword(data.password, user.passwordHash);
    if (!ok) throw new Error('Senha inválida.');

    return { id: user.id, name: user.name, email: user.email, token: `session-${user.id}` };
  }


  async create(data: CreateInput) {
    const activeApps = await prisma.app.count({
      where: {
        ownerDiscordId: data.ownerDiscordId,
        status: { in: [AppStatus.created, AppStatus.uploading, AppStatus.building, AppStatus.deploying, AppStatus.running] }
      }
    });

    if (activeApps >= data.maxHostedBots) {
      throw new Error(`Limite do plano atingido: máximo ${data.maxHostedBots} bots ativos.`);
    }

    return prisma.app.create({ data });
  }

  list(ownerDiscordId?: string) { return prisma.app.findMany({ where: ownerDiscordId ? { ownerDiscordId } : undefined, orderBy: { updatedAt: 'desc' } }); }
  get(id: string) { return prisma.app.findUnique({ where: { id } }); }

  async uploadZip(appId: string, zip: Buffer) {
    const app = await this.mustGet(appId);
    const uploadBytesLimit = app.maxUploadMb * 1024 * 1024;
    if (zip.length > uploadBytesLimit) {
      throw new Error(`Arquivo excede limite do plano (${app.maxUploadMb}MB).`);
    }

    await prisma.app.update({ where: { id: app.id }, data: { status: AppStatus.uploading } });
    const zipGsUrl = await this.gcp.uploadZip(app.region as 'br' | 'us', `${app.ownerDiscordId}/${app.id}/${Date.now()}.zip`, zip);
    const image = this.gcp.getImagePath(app.id);
    await prisma.app.update({ where: { id: app.id }, data: { zipGsUrl, image } });
    await this.buildQueue.enqueueBuild({ appId: app.id, ownerId: app.ownerDiscordId, region: app.region as 'br' | 'us', zipGsUrl, image });
    return prisma.app.findUnique({ where: { id: app.id } });
  }

  async deploy(appId: string) {
    const app = await this.mustGet(appId);
    if (!app.zipGsUrl || !app.image) throw new Error('App ainda não possui upload/build associado');
    await this.buildQueue.enqueueBuild({ appId: app.id, ownerId: app.ownerDiscordId, region: app.region as 'br' | 'us', zipGsUrl: app.zipGsUrl, image: app.image });
    return prisma.app.findUnique({ where: { id: app.id } });
  }

  async restart(appId: string) {
    const app = await this.mustGet(appId);
    await this.k8s.restart(app.namespace ?? `${env.K8S_NAMESPACE_PREFIX}${app.ownerDiscordId}`, app.deploymentName ?? `app-${app.id}`, app.region as 'br' | 'us');
    return { ok: true };
  }

  async stop(appId: string) {
    const app = await this.mustGet(appId);
    await this.k8s.stop(app.namespace ?? `${env.K8S_NAMESPACE_PREFIX}${app.ownerDiscordId}`, app.deploymentName ?? `app-${app.id}`, app.region as 'br' | 'us');
    await prisma.app.update({ where: { id: app.id }, data: { status: AppStatus.stopped } });
    return { ok: true };
  }

  async logs(appId: string) {
    const app = await this.mustGet(appId);
    return { logs: await this.k8s.logs(app.namespace ?? `${env.K8S_NAMESPACE_PREFIX}${app.ownerDiscordId}`, app.deploymentName ?? `app-${app.id}`, app.region as 'br' | 'us') };
  }

  async move(appId: string, region: Region) {
    const app = await this.mustGet(appId);
    await prisma.app.update({ where: { id: app.id }, data: { region, status: AppStatus.deploying } });
    if (app.image) {
      await this.k8s.deployApp({
        appId: app.id,
        ownerId: app.ownerDiscordId,
        region: region as 'br' | 'us',
        image: app.image,
        namespace: app.namespace ?? `${env.K8S_NAMESPACE_PREFIX}${app.ownerDiscordId}`,
        deploymentName: app.deploymentName ?? `app-${app.id}`,
        cpuLimit: app.cpuLimit
      });
    }
    return prisma.app.update({ where: { id: app.id }, data: { status: AppStatus.running } });
  }



  async createFreeTier(data: {
    ownerDiscordId: string;
    type: 'bot' | 'minecraft' | 'hytale';
    targetAppId?: string;
    serverPresetId?: string;
    serverName?: string;
    locationId?: number;
    nodeId?: number;
  }) {
    const active = await prisma.freeTierService.count({ where: { ownerDiscordId: data.ownerDiscordId, status: 'active' } });
    if (active >= 1) throw new Error('Você já possui um serviço Free Tier ativo.');

    const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const presetByType: Record<'bot' | 'minecraft' | 'hytale', string> = {
      bot: 'bot-nodejs',
      minecraft: 'minecraft-paper',
      hytale: 'bot-nodejs'
    };

    const provisioned = await provisionFreeTier({
      discordUserId: data.ownerDiscordId,
      locationId: data.locationId,
      nodeId: data.nodeId,
      serverPresetId: data.serverPresetId ?? presetByType[data.type],
      serverName: data.serverName
    });

    const saved = await prisma.freeTierService.create({
      data: {
        ownerDiscordId: data.ownerDiscordId,
        type: data.type,
        targetAppId: data.targetAppId,
        status: 'active',
        endsAt,
        forwardedToFeatherpanel: true,
        featherpanelMessage: JSON.stringify({
          panelUserId: provisioned.panelUserId,
          serverId: provisioned.serverId,
          serverUuid: provisioned.serverUuid,
          nodeId: provisioned.nodeId,
          allocationId: provisioned.allocationId
        })
      }
    });

    return { ...saved, provisioned };
  }

  listFreeTier(ownerDiscordId: string) {
    return prisma.freeTierService.findMany({ where: { ownerDiscordId }, orderBy: { createdAt: 'desc' } });
  }

  async reportFreeTierAbuse(id: string, reason: string) {
    const current = await prisma.freeTierService.findUnique({ where: { id } });
    if (!current) throw new Error('Serviço free tier não encontrado.');

    const strikes = current.abuseStrikes + 1;
    const shouldSuspend = strikes >= 1;

    return prisma.freeTierService.update({
      where: { id },
      data: {
        abuseStrikes: strikes,
        status: shouldSuspend ? 'suspended' : current.status,
        suspendReason: shouldSuspend ? reason : current.suspendReason
      }
    });
  }



  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derived}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [salt, original] = stored.split(':');
    if (!salt || !original) return false;
    const derived = scryptSync(password, salt, 64).toString('hex');
    return timingSafeEqual(Buffer.from(original, 'hex'), Buffer.from(derived, 'hex'));
  }

  private async mustGet(id: string) {
    const app = await prisma.app.findUnique({ where: { id } });
    if (!app) throw new Error('App não encontrada');
    return app;
  }
}
