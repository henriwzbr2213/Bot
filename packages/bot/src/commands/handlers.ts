import { writeFile } from 'node:fs/promises';
import {
  ActionRowBuilder,
  ChannelType,
  Interaction,
  Message,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import { REGIONS, Region, USER_PLANS, type PlanInfo } from '@discloud-gke/shared';
import { ApiClient } from '../services/apiClient';

const api = new ApiClient();

type TicketMode = 'up' | 'commit';

type TicketSession = {
  ownerId: string;
  mode: TicketMode;
  plan: PlanInfo;
  region?: Region;
  targetAppId?: string;
  targetAppName?: string;
};

type BotApp = {
  id: string;
  name: string;
  region: Region;
  status: string;
  plan: string;
  maxUploadMb: number;
  cpuLimit: string;
};

const ticketSessions = new Map<string, TicketSession>();

function sanitizeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\.zip$/i, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || `app-${Date.now().toString().slice(-6)}`;
}

function resolvePlan(message: Message): PlanInfo | null {
  const memberRoles = message.member?.roles;
  if (!memberRoles || !('cache' in memberRoles)) return null;

  if (memberRoles.cache.some((role) => role.name === 'Canary Premium')) {
    return USER_PLANS.find((p) => p.id === 'canary-premium') ?? null;
  }

  if (memberRoles.cache.some((role) => role.name === 'Neurion Basic')) {
    return USER_PLANS.find((p) => p.id === 'neurion-basic') ?? null;
  }

  return null;
}

async function openTicket(message: Message, mode: TicketMode, plan: PlanInfo, appsForCommit: BotApp[] = []) {
  if (!message.guild) {
    await message.reply('Esse comando só funciona dentro de servidor.');
    return;
  }

  const channel = await message.guild.channels.create({
    name: `${mode}-ticket-${message.author.username}`.toLowerCase().slice(0, 90),
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: message.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: message.author.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      ...(process.env.TICKET_STAFF_ROLE_ID
        ? [{ id: process.env.TICKET_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }]
        : [])
    ],
    parent: process.env.TICKET_CATEGORY_ID || null
  });

  const session: TicketSession = { ownerId: message.author.id, mode, plan };
  ticketSessions.set(channel.id, session);

  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder>> = [];

  const regionSelect = new StringSelectMenuBuilder()
    .setCustomId(`ticket_region:${channel.id}`)
    .setPlaceholder('Selecione a região')
    .addOptions(
      REGIONS.map((region) => ({
        label: `${region.label} (${region.id.toUpperCase()})`,
        value: region.id,
        description: region.description
      }))
    );

  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(regionSelect));

  if (mode === 'commit' && appsForCommit.length > 1) {
    const appSelect = new StringSelectMenuBuilder()
      .setCustomId(`ticket_app:${channel.id}`)
      .setPlaceholder('Escolha qual app/bot você quer modificar')
      .addOptions(
        appsForCommit.slice(0, 25).map((app) => ({
          label: app.name,
          value: app.id,
          description: `Região ${app.region.toUpperCase()} • status ${app.status}`
        }))
      );

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(appSelect));
  }

  if (mode === 'commit' && appsForCommit.length === 1) {
    session.targetAppId = appsForCommit[0].id;
    session.targetAppName = appsForCommit[0].name;
    ticketSessions.set(channel.id, session);
  }

  await channel.send({
    content:
      `Olá <@${message.author.id}>!\n` +
      `Modo: **${mode.toUpperCase()}**\n` +
      `Plano: **${plan.label}** | limite upload **${plan.maxUploadMb}MB** | CPU máx **${plan.cpuLimit}** | bots ativos **${plan.maxHostedBots}**\n\n` +
      (mode === 'up'
        ? '1) Selecione a região.\n2) Envie o `.zip` aqui. O nome da app será criado automaticamente pelo nome do arquivo.'
        : appsForCommit.length > 1
          ? '1) Selecione região.\n2) Selecione o bot/app que deseja alterar.\n3) Envie o `.zip` aqui para rebuild.'
          : '1) Selecione região.\n2) Envie o `.zip` aqui para rebuild.'),
    components: rows
  });

  await message.reply(`Ticket aberto: <#${channel.id}>`);
}

async function processZipInTicket(message: Message) {
  const session = ticketSessions.get(message.channel.id);
  if (!session || message.author.id !== session.ownerId) return;

  const attachment = message.attachments.first();
  if (!attachment) return;

  if (!attachment.name?.endsWith('.zip') || !attachment.url) {
    await message.reply('Envie um arquivo `.zip` válido.');
    return;
  }

  if (!session.region) {
    await message.reply('Selecione a região primeiro no menu do ticket.');
    return;
  }

  if (session.mode === 'commit' && !session.targetAppId) {
    await message.reply('Escolha o bot/app que deseja modificar no menu do ticket antes de enviar o zip.');
    return;
  }

  const sizeMb = (attachment.size ?? 0) / (1024 * 1024);
  if (sizeMb > session.plan.maxUploadMb) {
    await message.reply(`Arquivo maior que o limite do plano (${session.plan.maxUploadMb}MB).`);
    return;
  }

  const tmpFile = `/tmp/upload-${Date.now()}.zip`;
  const bin = await (await fetch(attachment.url)).arrayBuffer();
  await writeFile(tmpFile, Buffer.from(bin));

  let appId = session.targetAppId;
  let appName = session.targetAppName;

  if (session.mode === 'up') {
    const generatedName = sanitizeName(attachment.name);
    const app = await api.getOrCreate(session.ownerId, generatedName, session.region, {
      plan: session.plan.id,
      maxUploadMb: session.plan.maxUploadMb,
      cpuLimit: session.plan.cpuLimit,
      maxHostedBots: session.plan.maxHostedBots
    });
    appId = app.id;
    appName = app.name;
  }

  if (session.mode === 'commit' && session.targetAppId) {
    appId = session.targetAppId;
  }

  if (!appId) {
    await message.reply('Não foi possível identificar a app alvo.');
    return;
  }

  await api.uploadZip(appId, tmpFile);

  await message.reply(
    `✅ Upload recebido e pipeline iniciado.\n` +
      `App: **${appName ?? appId}**\n` +
      `Região: **${session.region.toUpperCase()}**\n` +
      `Plano: **${session.plan.label}**`
  );
}

export async function handleCommand(message: Message, prefix: string) {
  await processZipInTicket(message);

  if (!message.content.startsWith(prefix) || !message.author) return;
  const [cmd] = message.content.slice(prefix.length).trim().split(/\s+/);

  if (cmd === 'plans') {
    await message.reply(
      USER_PLANS.map((p) => `**${p.label}** — cargo: ${p.roleName} | upload: ${p.maxUploadMb}MB | CPU: ${p.cpuLimit} | bots: ${p.maxHostedBots}`).join('\n')
    );
    return;
  }

  if (cmd === 'up') {
    const plan = resolvePlan(message);
    if (!plan) return void message.reply('Você precisa do cargo **Neurion Basic** ou **Canary Premium**.');
    await message.react('✅');
    await openTicket(message, 'up', plan);
    return;
  }

  if (cmd === 'commit') {
    const plan = resolvePlan(message);
    if (!plan) return void message.reply('Você precisa do cargo **Neurion Basic** ou **Canary Premium**.');

    const apps = (await api.listApps(message.author.id)) as BotApp[];
    if (apps.length === 0) return void message.reply('Você não possui apps para modificar. Use `.up` primeiro.');

    await message.react('✅');
    await openTicket(message, 'commit', plan, apps);
    return;
  }

  if (cmd === 'status') {
    const [, name] = message.content.slice(prefix.length).trim().split(/\s+/);
    if (!name) return void message.reply(`Uso: ${prefix}status <nome>`);
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void message.reply('App não encontrada.');
    await message.reply(`**${app.name}** | plano: ${app.plan} | região: ${app.region.toUpperCase()} | status: ${app.status} | CPU: ${app.cpuLimit}`);
    return;
  }

  if (cmd === 'logs' || cmd === 'console') {
    const [, name] = message.content.slice(prefix.length).trim().split(/\s+/);
    if (!name) return void message.reply(`Uso: ${prefix}${cmd} <nome>`);
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void message.reply('App não encontrada.');
    const logs = await api.logs(app.id);
    await message.reply(`\`\`\`${logs.slice(0, 1800)}\`\`\``);
    return;
  }

  if (cmd === 'restart' || cmd === 'stop') {
    const [, name] = message.content.slice(prefix.length).trim().split(/\s+/);
    if (!name) return void message.reply(`Uso: ${prefix}${cmd} <nome>`);
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void message.reply('App não encontrada.');
    await api.action(app.id, cmd);
    await message.reply(`Comando **${cmd}** enviado para ${name}.`);
    return;
  }

  if (cmd === 'move') {
    const [, name, regionArg] = message.content.slice(prefix.length).trim().split(/\s+/);
    const region = regionArg as Region;
    if (!name || !region || !['br', 'us'].includes(region)) return void message.reply(`Uso: ${prefix}move <nome> <br|us>`);
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void message.reply('App não encontrada.');
    await api.move(app.id, region);
    await message.reply(`App ${name} movida para ${region.toUpperCase()}.`);
  }
}

export async function handleSelectInteraction(interaction: Interaction) {
  if (!interaction.isStringSelectMenu()) return;

  if (interaction.customId.startsWith('ticket_region:')) {
    const channelId = interaction.customId.split(':')[1];
    const session = ticketSessions.get(channelId);
    if (!session) return void interaction.reply({ content: 'Sessão de ticket expirada.', ephemeral: true });
    if (interaction.user.id !== session.ownerId) {
      return void interaction.reply({ content: 'Apenas o dono do ticket pode usar isso.', ephemeral: true });
    }

    session.region = interaction.values[0] as Region;
    ticketSessions.set(channelId, session);

    return void interaction.reply({ content: `Região definida para **${session.region.toUpperCase()}**.`, ephemeral: true });
  }

  if (interaction.customId.startsWith('ticket_app:')) {
    const channelId = interaction.customId.split(':')[1];
    const session = ticketSessions.get(channelId);
    if (!session) return void interaction.reply({ content: 'Sessão de ticket expirada.', ephemeral: true });
    if (interaction.user.id !== session.ownerId) {
      return void interaction.reply({ content: 'Apenas o dono do ticket pode usar isso.', ephemeral: true });
    }

    session.targetAppId = interaction.values[0];
    session.targetAppName = interaction.component.options.find((o) => o.value === session.targetAppId)?.label;
    ticketSessions.set(channelId, session);

    return void interaction.reply({
      content: `App selecionada: **${session.targetAppName ?? session.targetAppId}**. Agora envie o .zip.`,
      ephemeral: true
    });
  }
}
