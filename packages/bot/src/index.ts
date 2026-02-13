import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import { handleCommand, handleSelectInteraction } from './commands/handlers';

dotenv.config({ path: '../../.env' });
dotenv.config();

const token = process.env.DISCORD_TOKEN;
const prefix = process.env.BOT_PREFIX ?? '.';

if (!token) throw new Error('Defina DISCORD_TOKEN');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('ready', () => {
  console.log(`Bot online como ${client.user?.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    await handleSelectInteraction(interaction);
  } catch (err) {
    console.error(err);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  try {
    await handleCommand(message, prefix);
  } catch (err) {
    console.error(err);
    await message.reply('Erro ao processar comando.');
  }
});

client.login(token);
