import { writeFile } from 'node:fs/promises';
import {
  ActionRowBuilder,
  ChannelType,
  Message,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  Interaction
} from 'discord.js';
import { REGIONS, Region, USER_PLANS, type PlanInfo } from '@discloud-gke/shared';
import { ApiClient } from '../services/apiClient';

const api = new ApiClient();
const ticketSessions = new Map<string, { ownerId: string; appName: string; plan: PlanInfo; region?: Region }>();

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

async function openUploadTicket(message: Message, appName: string, plan: PlanInfo) {
  if (!message.guild) {
    await message.reply('O comando .up deve ser usado dentro de um servidor.');
    return;
  }

  const channel = await message.guild.channels.create({
    name: `ticket-${message.author.username}-${Date.now().toString().slice(-4)}`,
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
    parent: process.env.TICKET_CATEGORY_ID || null,
    reason: `Upload request for ${appName}`
  });

  ticketSessions.set(channel.id, {
    ownerId: message.author.id,
    appName,
    plan
  });

  const regionSelect = new StringSelectMenuBuilder()
    .setCustomId(`ticket_region:${channel.id}`)
    .setPlaceholder('Selecione a região de deploy')
    .addOptions(
      REGIONS.map((region) => ({
        label: `${region.label} (${region.id.toUpperCase()})`,
        value: region.id,
        description: region.description
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(regionSelect);

  await channel.send({
    content:
      `Olá <@${message.author.id}>!\n` +
      `Plano detectado: **${plan.label}**\n` +
      `Limites: **${plan.maxUploadMb}MB**, CPU máx **${plan.cpuLimit}**, até **${plan.maxHostedBots}** bots ativos.\n\n` +
      '1) Escolha a região no seletor abaixo.\n2) Envie o arquivo `.zip` aqui no ticket.\n3) A rede fará build e deploy automaticamente.',
    components: [row]
  });

  await message.reply(`Ticket privado criado: <#${channel.id}>`);
}

async function handleTicketUpload(message: Message) {
  const session = ticketSessions.get(message.channel.id);
  if (!session) return;
  if (message.author.id !== session.ownerId) return;

  const attachment = message.attachments.first();
  if (!attachment) return;

  if (!session.region) {
    await message.reply('Selecione a região primeiro no menu acima.');
    return;
  }

  if (!attachment.name?.endsWith('.zip') || !attachment.url) {
    await message.reply('Envie um arquivo `.zip` válido.');
    return;
  }

  const attachmentMb = (attachment.size ?? 0) / (1024 * 1024);
  if (attachmentMb > session.plan.maxUploadMb) {
    await message.reply(`Seu plano permite até ${session.plan.maxUploadMb}MB. Arquivo recebido: ${attachmentMb.toFixed(1)}MB.`);
    return;
  }

  const app = await api.getOrCreate(session.ownerId, session.appName, session.region, {
    plan: session.plan.id,
    maxUploadMb: session.plan.maxUploadMb,
    cpuLimit: session.plan.cpuLimit,
    maxHostedBots: session.plan.maxHostedBots
  });

  const tmpFile = `/tmp/${app.id}-${Date.now()}.zip`;
  const bin = await (await fetch(attachment.url)).arrayBuffer();
  await writeFile(tmpFile, Buffer.from(bin));
  await api.uploadZip(app.id, tmpFile);

  await message.reply(
    `Upload iniciado com sucesso.\n` +
      `App: **${session.appName}**\n` +
      `Região: **${session.region.toUpperCase()}**\n` +
      `Plano: **${session.plan.label}**\n` +
      `CPU limite: **${session.plan.cpuLimit}**`
  );
}

export async function handleCommand(message: Message, prefix: string) {
  await handleTicketUpload(message);

  if (!message.content.startsWith(prefix) || !message.author) return;
  const [cmd, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);

  if (cmd === 'plans') {
    await message.reply(
      USER_PLANS.map((p) => `**${p.label}** — role: ${p.roleName} | upload: ${p.maxUploadMb}MB | CPU: ${p.cpuLimit} | bots: ${p.maxHostedBots}`).join('\n')
    );
    return;
  }

  if (cmd === 'up') {
    const name = args[0];
    if (!name) return void message.reply(`Uso: ${prefix}up <nome>`);

    const plan = resolvePlan(message);
    if (!plan) {
      await message.reply('Você precisa ter o cargo **Neurion Basic** ou **Canary Premium** para abrir ticket de upload.');
      return;
    }

    await openUploadTicket(message, name, plan);
    return;
  }

  if (cmd === 'commit') {
    const [name, regionArg] = args;
    if (!name || !regionArg || !['br', 'us'].includes(regionArg)) {
      return void message.reply(`Uso: ${prefix}commit <nome> <br|us> (com anexo .zip)`);
    }

    const plan = resolvePlan(message);
    if (!plan) return void message.reply('Sem cargo de plano válido.');

    const attachment = message.attachments.first();
    if (!attachment?.name?.endsWith('.zip') || !attachment.url) {
      return void message.reply('Anexe um .zip na mesma mensagem do comando.');
    }

    const attachmentMb = (attachment.size ?? 0) / (1024 * 1024);
    if (attachmentMb > plan.maxUploadMb) {
      return void message.reply(`Seu plano permite no máximo ${plan.maxUploadMb}MB.`);
    }

    const app = await api.getOrCreate(message.author.id, name, regionArg as Region, {
      plan: plan.id,
      maxUploadMb: plan.maxUploadMb,
      cpuLimit: plan.cpuLimit,
      maxHostedBots: plan.maxHostedBots
    });

    const tmpFile = `/tmp/${app.id}-${Date.now()}.zip`;
    const bin = await (await fetch(attachment.url)).arrayBuffer();
    await writeFile(tmpFile, Buffer.from(bin));
    await api.uploadZip(app.id, tmpFile);
    await message.reply(`Commit enviado. Rebuild/deploy iniciado para **${name}**.`);
    return;
  }

  if (cmd === 'status') {
    const name = args[0];
    if (!name) return void message.reply(`Uso: ${prefix}status <nome>`);
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void message.reply('App não encontrada.');
    await message.reply(`**${app.name}** | plano: ${app.plan} | região: ${app.region.toUpperCase()} | status: ${app.status} | CPU: ${app.cpuLimit}`);
    return;
  }

  if (cmd === 'logs') {
    const name = args[0];
    if (!name) return void message.reply(`Uso: ${prefix}logs <nome>`);
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void message.reply('App não encontrada.');
    const logs = await api.logs(app.id);
    await message.reply(`\`\`\`${logs.slice(0, 1800)}\`\`\``);
    return;
  }

  if (cmd === 'restart' || cmd === 'stop') {
    const name = args[0];
    if (!name) return void message.reply(`Uso: ${prefix}${cmd} <nome>`);
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void message.reply('App não encontrada.');
    await api.action(app.id, cmd);
    await message.reply(`Comando **${cmd}** enviado para ${name}.`);
    return;
  }

  if (cmd === 'move') {
    const [name, regionArg] = args;
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
  if (!interaction.customId.startsWith('ticket_region:')) return;

  const channelId = interaction.customId.split(':')[1];
  const session = ticketSessions.get(channelId);

  if (!session) {
    await interaction.reply({ content: 'Sessão de ticket expirada.', ephemeral: true });
    return;
  }

  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({ content: 'Apenas o dono do ticket pode selecionar a região.', ephemeral: true });
    return;
  }

  const selected = interaction.values[0] as Region;
  session.region = selected;
  ticketSessions.set(channelId, session);

  await interaction.reply({
    content: `Região selecionada: **${selected.toUpperCase()}**. Agora envie seu arquivo .zip neste ticket.`,
    ephemeral: true
  });
}
