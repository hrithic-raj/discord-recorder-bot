import 'dotenv/config';
import fs from 'fs';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}. Check your .env file.`);
  return val;
}

export const config = {
  discord: {
    token:    requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('DISCORD_CLIENT_ID'),
  },
  google: {
    credentialsFile: process.env['GOOGLE_CREDENTIALS_FILE'] ?? 'credentials.json',
    driveFolderId:   process.env['GOOGLE_DRIVE_FOLDER_ID'] ?? '',
  },
  recording: {
    dir:          process.env['RECORDINGS_DIR'] ?? './recordings',
    maxHours:     parseInt(process.env['MAX_RECORDING_HOURS'] ?? '6', 10),
    autoChannels: (process.env['AUTO_RECORD_CHANNELS'] ?? '')
      .split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)),
  },
} as const;

// Ensure recordings dir exists at startup
fs.mkdirSync(config.recording.dir, { recursive: true });
