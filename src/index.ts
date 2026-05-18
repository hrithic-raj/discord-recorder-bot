import {
  Client, GatewayIntentBits, Collection,
  Events, ChatInputCommandInteraction,
} from 'discord.js';
import { config }             from './config';
import { RecordingManager }   from './utils/recordingManager';
import { createLogger }       from './utils/logger';
import { onVoiceStateUpdate } from './events/voiceStateUpdate';
import { autoChannels }       from './commands/autoChannels';
import { BotCommand }         from './commands/types';

import { command as startRecording }  from './commands/startRecording';
import { command as stopRecording }   from './commands/stopRecording';
import { command as recordingStatus } from './commands/recordingStatus';
import {
  addAutoChannelCmd,
  removeAutoChannelCmd,
  listAutoChannelsCmd,
} from './commands/autoChannels';
const express = require("express");
const app = express();

const log = createLogger('Bot');


const PORT = process.env.PORT || 3000;

app.get("/", (req:any, res:any) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});
app.get('/health', (req:any, res:any) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});



const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const commands = new Collection<string, BotCommand>();
for (const cmd of [startRecording, stopRecording, recordingStatus,
                   addAutoChannelCmd, removeAutoChannelCmd, listAutoChannelsCmd]) {
  commands.set(cmd.data.name, cmd);
}

const manager = new RecordingManager();

// Seed auto-record channels from .env
for (const id of config.recording.autoChannels) autoChannels.add(id);

client.once(Events.ClientReady, c => {
  log.info(`✅ Logged in as ${c.user.tag}`);
  log.info(`Auto-record channels: ${[...autoChannels].join(', ') || 'none'}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction as ChatInputCommandInteraction, manager);
  } catch (err) {
    log.error(`Error in /${interaction.commandName}`, err);
    const msg = { content: '❌ Something went wrong.', ephemeral: true };
    interaction.replied || interaction.deferred
      ? interaction.followUp(msg).catch(() => {})
      : interaction.reply(msg).catch(() => {});
  }
});

// onVoiceStateUpdate is debounced internally — just call it synchronously
client.on(Events.VoiceStateUpdate, (o, n) => {
  onVoiceStateUpdate(o, n, manager);
});

client.login(config.discord.token).catch(err => {
  log.error('Login failed', err);
  process.exit(1);
});
