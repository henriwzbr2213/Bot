import { writeFile } from 'node:fs/promises';
import { Message } from 'discord.js';
import { PLANS, Region } from '@discloud-gke/shared';
import { ApiClient } from '../services/apiClient';

const api = new ApiClient();

export async function handleCommand(message: Message, prefix: string) {
  if (!message.content.startsWith(prefix) || !message.author) return;
  const [cmd, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);

  if (cmd === 'plans') {
    await message.reply(PLANS.map((p) => `**${p.id.toUpperCase()}** - ${p.label} (${p.priceHint})`).join('\n'));
    return;
  }

  if (cmd === 'up' || cmd === 'commit') {
    const [name, regionArg] = args;
    if (!name) return void message.reply(`Uso: ${prefix}${cmd} <nome> <br|us>`);
    const region = (regionArg ?? 'us') as Region;
    if (!['br', 'us'].includes(region)) return void message.reply('Região inválida. Use br|us.');
    const attachment = message.attachments.first();
    if (!attachment?.name?.endsWith('.zip') || !attachment.url) {
      return void message.reply('Anexe um .zip na mesma mensagem do comando.');
    }

    const app = await api.getOrCreate(message.author.id, name, region);
    const tmpFile = `/tmp/${app.id}-${Date.now()}.zip`;
    const bin = await (await fetch(attachment.url)).arrayBuffer();
    await writeFile(tmpFile, Buffer.from(bin));
    await api.uploadZip(app.id, tmpFile);
    await message.reply(`Upload recebido. Build/deploy iniciado para **${name}** em **${region.toUpperCase()}**.`);
    return;
  }

  if (cmd === 'status') {
    const name = args[0];
    if (!name) return void message.reply(`Uso: ${prefix}status <nome>`);
    const app = await api.statusByName(message.author.id, name);
    if (!app) return void message.reply('App não encontrada.');
    await message.reply(`**${app.name}** | região: ${app.region.toUpperCase()} | status: ${app.status}`);
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
