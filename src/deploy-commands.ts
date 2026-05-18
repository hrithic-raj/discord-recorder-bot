/**
 * Run once after setup to register slash commands with Discord:
 *   npm run deploy-commands
 */
import { REST, Routes } from 'discord.js';
import { config } from './config';
import { createLogger } from './utils/logger';

import { command as startRecording }  from './commands/startRecording';
import { command as stopRecording }   from './commands/stopRecording';
import { command as recordingStatus } from './commands/recordingStatus';
import {
  addAutoChannelCmd,
  removeAutoChannelCmd,
  listAutoChannelsCmd,
} from './commands/autoChannels';

const log = createLogger('Deploy');

const body = [
  startRecording, stopRecording, recordingStatus,
  addAutoChannelCmd, removeAutoChannelCmd, listAutoChannelsCmd,
].map(c => c.data.toJSON());

const rest = new REST().setToken(config.discord.token);

(async () => {
  log.info(`Registering ${body.length} slash commands…`);
  await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
  log.info('✅ Done! Commands may take up to 1 hour to appear globally.');
})().catch(err => { log.error('Failed', err); process.exit(1); });
