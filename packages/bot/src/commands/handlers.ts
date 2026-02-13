import { writeFile } from 'node:fs/promises';
import {
  ActionRowBuilder,
  ChannelType,
  Interaction,
  Message,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type TextChannel
} from 'discord.js';
import { REGIONS, Region, USER_PLANS, type PlanInfo } from '@discloud-gke/shared';
import { ApiClient, FreeTierApiClient } from '../services/apiClient';

const api = new ApiClient();
const freeTierApi = new FreeTierApiClient();

const FREETIER_QUESTIONS = [
  { key: 'projectName', label: 'Qual nome do projeto/servidor?' },
  { key: 'useCase', label: 'Qual o objetivo de uso (resumo)?' },
  { key: 'estimatedResources', label: 'Qual consumo estimado (CPU/RAM/Jogadores)?' },
  { key: 'contact', label: 'Qual contato principal (Discord/tag)?' }
] as const;

type TicketMode = 'up' | 'commit' | 'freetier';
type FreetierType = 'bot' | 'minecraft' | 'hytale';

type TicketSession = {
  ownerId: string;
  mode: TicketMode;
  plan?: PlanInfo;
  region?: Region;
  targetAppId?: string;
  targetAppName?: string;
  freetierType?: FreetierType;
  freetierAnswers?: Record<string, string>;
  freetierQuestionIndex?: number;
  freetierSubmitted?: boolean;
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
  return input.toLowerCase().replace(/\.zip$/i, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `app-${Date.now().toString().slice(-6)}`;
}

function resolvePlan(message: Message): PlanInfo | null {
  const memberRoles = message.member?.roles;
  if (!memberRoles || !('cache' in memberRoles)) return null;
  if (memberRoles.cache.some((r) => r.name === 'Canary Premium')) return USER_PLANS.find((p) => p.id === 'canary-premium') ?? null;
  if (memberRoles.cache.some((r) => r.name === 'Neurion Basic')) return USER_PLANS.find((p) => p.id === 'neurion-basic') ?? null;
  return null;
}

async function sendFreeTierToAdmin(channel: TextChannel, session: TicketSession) {
  const adminChannelId = process.env.HOST_ADMIN_CHANNEL_ID;
  if (!adminChannelId) return;

  const admin = channel.guild.channels.cache.get(adminChannelId);
  if (!admin || admin.type !== ChannelType.GuildText) return;

  const answers = session.freetierAnswers ?? {};
  const lines = FREETIER_QUESTIONS.map((q) => `- **${q.label}**: ${answers[q.key] ?? 'não informado'}`).join('\n');

  await admin.send(
    `📨 **Novo pedido FreeTier**\n` +
      `Usuário: <@${session.ownerId}>\n` +
      `Tipo: **${session.freetierType?.toUpperCase()}**\n` +
      `Região: **${session.region?.toUpperCase() ?? 'N/A'}**\n` +
      `App alvo: **${session.targetAppName ?? session.targetAppId ?? 'N/A'}**\n\n` +
      `**Questionário:**\n${lines}`
  );
}

async function openTicket(message: Message, mode: TicketMode, plan?: PlanInfo, apps: BotApp[] = []) {
  if (!message.guild) return void (await message.reply('Esse comando só funciona dentro de servidor.'));

  const channel = await message.guild.channels.create({
    name: `${mode}-ticket-${message.author.username}`.toLowerCase().slice(0, 90),
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: message.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: message.author.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ...(process.env.TICKET_STAFF_ROLE_ID ? [{ id: process.env.TICKET_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : [])
    ],
    parent: process.env.TICKET_CATEGORY_ID || null
  });

  const session: TicketSession = { ownerId: message.author.id, mode, plan };
  ticketSessions.set(channel.id, session);

  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder>> = [];

  const regionSelect = new StringSelectMenuBuilder()
    .setCustomId(`ticket_region:${channel.id}`)
    .setPlaceholder('Selecione a região')
    .addOptions(REGIONS.map((r) => ({ label: `${r.label} (${r.id.toUpperCase()})`, value: r.id, description: r.description })));

  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(regionSelect));

  if (mode === 'commit' || mode === 'freetier') {
    if (apps.length > 1) {
      const appSelect = new StringSelectMenuBuilder()
        .setCustomId(`ticket_app:${channel.id}`)
        .setPlaceholder('Escolha o bot/app alvo')
        .addOptions(apps.slice(0, 25).map((a) => ({ label: a.name, value: a.id, description: `Região ${a.region.toUpperCase()} • ${a.status}` })));
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(appSelect));
    } else if (apps.length === 1) {
      session.targetAppId = apps[0].id;
      session.targetAppName = apps[0].name;
      ticketSessions.set(channel.id, session);
    }
  }

  if (mode === 'freetier') {
    const freeTierTypeSelect = new StringSelectMenuBuilder()
      .setCustomId(`ticket_freetier_type:${channel.id}`)
      .setPlaceholder('Escolha o tipo de hospedagem Free Tier')
      .addOptions([
        { label: 'Bot (upload .zip)', value: 'bot', description: 'Hospeda seu bot por 30 dias (requer upload)' },
        { label: 'Minecraft', value: 'minecraft', description: 'Hospedagem de jogo por 30 dias' },
        { label: 'Hytale', value: 'hytale', description: 'Hospedagem de jogo por 30 dias' }
      ]);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(freeTierTypeSelect));
  }

  const help = mode === 'up'
    ? 'Selecione região e envie `.zip` para criar app automaticamente.'
    : mode === 'commit'
      ? 'Selecione região e app alvo, depois envie `.zip` para rebuild.'
      : 'Selecione região + tipo de serviço. Depois responda o questionário e o bot enviará para o admin da host.';

  await channel.send({
    content:
      `Olá <@${message.author.id}>!\n` +
      `Modo: **${mode.toUpperCase()}**\n` +
      (plan ? `Plano: **${plan.label}** | upload **${plan.maxUploadMb}MB** | CPU máx **${plan.cpuLimit}**\n` : 'Plano: **Free Tier**\n') +
      help,
    components: rows
  });

  await message.reply(`Ticket aberto: <#${channel.id}>`);
}

async function handleFreeTierQuestionnaire(message: Message, session: TicketSession): Promise<boolean> {
  if (session.mode !== 'freetier' || !session.freetierType) return false;
  if (session.freetierSubmitted) return false;
  if (message.content.startsWith(process.env.BOT_PREFIX ?? '.')) return false;

  const idx = session.freetierQuestionIndex ?? 0;
  if (idx >= FREETIER_QUESTIONS.length) return false;

  const current = FREETIER_QUESTIONS[idx];
  session.freetierAnswers = session.freetierAnswers ?? {};
  session.freetierAnswers[current.key] = message.content.trim().slice(0, 500);
  session.freetierQuestionIndex = idx + 1;
  ticketSessions.set(message.channel.id, session);

  const next = FREETIER_QUESTIONS[idx + 1];
  if (next) {
    await message.reply(`✅ Resposta salva. Próxima pergunta:\n**${next.label}**`);
    return true;
  }

  const payload = {
    ownerDiscordId: session.ownerId,
    type: session.freetierType,
    targetAppId: session.targetAppId,
    region: session.region,
    questionnaire: session.freetierAnswers
  };

  const created = await freeTierApi.createFreeTierService(payload);
  session.freetierSubmitted = true;
  ticketSessions.set(message.channel.id, session);

  if (message.channel.type === ChannelType.GuildText) {
    await sendFreeTierToAdmin(message.channel, session);
  }

  await message.reply(
    `📨 Pedido FreeTier enviado para análise da host.\n` +
      `Tipo: **${session.freetierType.toUpperCase()}**\n` +
      `Validade inicial: até ${new Date(created.endsAt).toLocaleDateString('pt-BR')}\n` +
      `Agora aguarde o admin da host aprovar.`
  );

  if (session.freetierType === 'bot') {
    await message.reply('Agora envie o `.zip` neste ticket para anexar ao pedido de bot.');
  }

  return true;
}

async function processZipInTicket(message: Message) {
  const session = ticketSessions.get(message.channel.id);
  if (!session || message.author.id !== session.ownerId) return;

  if (await handleFreeTierQuestionnaire(message, session)) return;

  const attachment = message.attachments.first();
  if (!attachment) return;

  if (!attachment.name?.endsWith('.zip') || !attachment.url) return void (await message.reply('Envie um `.zip` válido.'));
  if (!session.region) return void (await message.reply('Selecione a região primeiro.'));

  if (session.mode === 'commit' && !session.targetAppId) return void (await message.reply('Escolha o bot/app alvo no menu antes do upload.'));
  if (session.mode === 'freetier' && session.freetierType !== 'bot') return;
  if (session.mode === 'freetier' && !session.freetierSubmitted) {
    return void (await message.reply('Responda primeiro o questionário do FreeTier.'));
  }

  const sizeMb = (attachment.size ?? 0) / (1024 * 1024);
  if (session.plan && sizeMb > session.plan.maxUploadMb) return void (await message.reply(`Arquivo maior que limite (${session.plan.maxUploadMb}MB).`));
  if (session.mode === 'freetier' && sizeMb > 200) return void (await message.reply('No Free Tier, limite de upload é 200MB.'));

  const tmpFile = `/tmp/upload-${Date.now()}.zip`;
  const bin = await (await fetch(attachment.url)).arrayBuffer();
  await writeFile(tmpFile, Buffer.from(bin));

  let appId = session.targetAppId;
  let appName = session.targetAppName;

  if (session.mode === 'up') {
    const plan = session.plan;
    if (!plan) return;
    const app = await api.getOrCreate(session.ownerId, sanitizeName(attachment.name), session.region, {
      plan: plan.id,
      maxUploadMb: plan.maxUploadMb,
      cpuLimit: plan.cpuLimit,
      maxHostedBots: plan.maxHostedBots
    });
    appId = app.id;
    appName = app.name;
  }

  if (session.mode === 'freetier' && session.freetierType === 'bot') {
    const apps = await api.listApps(session.ownerId) as BotApp[];
    const picked = session.targetAppId ? apps.find((a) => a.id === session.targetAppId) : apps[0];
    if (!picked) return void (await message.reply('Você precisa ter ao menos um bot/app para Free Tier do tipo bot.'));
    appId = picked.id;
    appName = picked.name;
  }

  if (!appId) return void (await message.reply('Não foi possível identificar a app alvo.'));

  await api.uploadZip(appId, tmpFile);
  await message.reply(`✅ Upload recebido e pipeline iniciado para **${appName ?? appId}** em **${session.region.toUpperCase()}**.`);
}

export async function handleCommand(message: Message, prefix: string) {
  await processZipInTicket(message);
  if (!message.content.startsWith(prefix) || !message.author) return;

  const [cmd] = message.content.slice(prefix.length).trim().split(/\s+/);

  if (cmd === 'plans') {
    return void (await message.reply(USER_PLANS.map((p) => `**${p.label}** — ${p.maxUploadMb}MB | CPU ${p.cpuLimit} | bots ${p.maxHostedBots}`).join('\n')));
  }

  if (cmd === 'up' || cmd === 'commit') {
    const plan = resolvePlan(message);
    if (!plan) return void (await message.reply('Você precisa do cargo **Neurion Basic** ou **Canary Premium**.'));
    await message.react('✅');

    if (cmd === 'up') return void (await openTicket(message, 'up', plan));

    const apps = await api.listApps(message.author.id) as BotApp[];
    if (apps.length === 0) return void (await message.reply('Você não possui apps para modificar. Use `.up` primeiro.'));
    return void (await openTicket(message, 'commit', plan, apps));
  }

  if (cmd === 'freetier') {
    await message.react('✅');
    const apps = await api.listApps(message.author.id) as BotApp[];
    return void (await openTicket(message, 'freetier', undefined, apps));
  }

  if (cmd === 'status') {
    const [, name] = message.content.slice(prefix.length).trim().split(/\s+/);
    if (!name) return void (await message.reply(`Uso: ${prefix}status <nome>`));
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void (await message.reply('App não encontrada.'));
    return void (await message.reply(`**${app.name}** | região ${app.region.toUpperCase()} | status ${app.status} | plano ${app.plan}`));
  }

  if (cmd === 'logs' || cmd === 'console') {
    const [, name] = message.content.slice(prefix.length).trim().split(/\s+/);
    if (!name) return void (await message.reply(`Uso: ${prefix}${cmd} <nome>`));
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void (await message.reply('App não encontrada.'));
    return void (await message.reply(`\`\`\`${(await api.logs(app.id)).slice(0, 1800)}\`\`\``));
  }

  if (cmd === 'restart' || cmd === 'stop') {
    const [, name] = message.content.slice(prefix.length).trim().split(/\s+/);
    if (!name) return void (await message.reply(`Uso: ${prefix}${cmd} <nome>`));
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void (await message.reply('App não encontrada.'));
    await api.action(app.id, cmd);
    return void (await message.reply(`Comando **${cmd}** enviado para ${name}.`));
  }

  if (cmd === 'move') {
    const [, name, regionArg] = message.content.slice(prefix.length).trim().split(/\s+/);
    const region = regionArg as Region;
    if (!name || !region || !['br', 'us'].includes(region)) return void (await message.reply(`Uso: ${prefix}move <nome> <br|us>`));
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void (await message.reply('App não encontrada.'));
    await api.move(app.id, region);
    return void (await message.reply(`App ${name} movida para ${region.toUpperCase()}.`));
  }
}

export async function handleSelectInteraction(interaction: Interaction) {
  if (!interaction.isStringSelectMenu()) return;

  const channelId = interaction.customId.split(':')[1];
  const session = ticketSessions.get(channelId);
  if (!session) return void (await interaction.reply({ content: 'Sessão de ticket expirada.', ephemeral: true }));
  if (interaction.user.id !== session.ownerId) return void (await interaction.reply({ content: 'Apenas o dono do ticket pode usar isso.', ephemeral: true }));

  if (interaction.customId.startsWith('ticket_region:')) {
    session.region = interaction.values[0] as Region;
    ticketSessions.set(channelId, session);
    return void (await interaction.reply({ content: `Região definida para **${session.region.toUpperCase()}**.`, ephemeral: true }));
  }

  if (interaction.customId.startsWith('ticket_app:')) {
    session.targetAppId = interaction.values[0];
    session.targetAppName = interaction.component.options.find((o) => o.value === session.targetAppId)?.label;
    ticketSessions.set(channelId, session);
    return void (await interaction.reply({ content: `App selecionada: **${session.targetAppName ?? session.targetAppId}**.`, ephemeral: true }));
  }

  if (interaction.customId.startsWith('ticket_freetier_type:')) {
    const type = interaction.values[0] as FreetierType;
    session.freetierType = type;
    session.freetierQuestionIndex = 0;
    session.freetierAnswers = {};
    session.freetierSubmitted = false;
    ticketSessions.set(channelId, session);

    const first = FREETIER_QUESTIONS[0];
    return void (await interaction.reply({
      content: `Tipo **${type.toUpperCase()}** selecionado.\nResponda o questionário para enviar ao admin da host.\n\n**Pergunta 1/${FREETIER_QUESTIONS.length}: ${first.label}**`,
      ephemeral: true
    }));
  }
}
