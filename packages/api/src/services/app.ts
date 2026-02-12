import { AppStatus, Region } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../utils/prisma';
import { GcpService } from './gcp';
import { K8sService } from './k8s';
import { InlineBuildQueue } from '../types/worker';

export class AppService {
  private gcp = new GcpService();
  private k8s = new K8sService();
  private buildQueue = new InlineBuildQueue(async (payload) => {
    await prisma.app.update({ where: { id: payload.appId }, data: { status: AppStatus.building } });
    await this.gcp.triggerCloudBuild({ appId: payload.appId, zipGsUrl: payload.zipGsUrl, image: payload.image });
    await prisma.app.update({ where: { id: payload.appId }, data: { image: payload.image, status: AppStatus.deploying } });
    const namespace = `${env.K8S_NAMESPACE_PREFIX}${payload.ownerId}`;
    const deploymentName = `app-${payload.appId}`;
    await this.k8s.deployApp({ appId: payload.appId, ownerId: payload.ownerId, image: payload.image, region: payload.region, namespace, deploymentName });
    await prisma.app.update({ where: { id: payload.appId }, data: { namespace, deploymentName, status: AppStatus.running } });
  });

  authDiscord(userId: string) { return Promise.resolve({ userId, token: `stub-${userId}` }); }
  create(data: { ownerDiscordId: string; name: string; region: Region }) { return prisma.app.create({ data }); }
  list(ownerDiscordId?: string) { return prisma.app.findMany({ where: ownerDiscordId ? { ownerDiscordId } : undefined, orderBy: { updatedAt: 'desc' } }); }
  get(id: string) { return prisma.app.findUnique({ where: { id } }); }

  async uploadZip(appId: string, zip: Buffer) {
    const app = await this.mustGet(appId);
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
      await this.k8s.deployApp({ appId: app.id, ownerId: app.ownerDiscordId, region: region as 'br' | 'us', image: app.image, namespace: app.namespace ?? `${env.K8S_NAMESPACE_PREFIX}${app.ownerDiscordId}`, deploymentName: app.deploymentName ?? `app-${app.id}` });
    }
    return prisma.app.update({ where: { id: app.id }, data: { status: AppStatus.running } });
  }

  private async mustGet(id: string) {
    const app = await prisma.app.findUnique({ where: { id } });
    if (!app) throw new Error('App não encontrada');
    return app;
  }
}
