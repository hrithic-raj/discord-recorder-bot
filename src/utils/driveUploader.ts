import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { createLogger } from './logger';

const log = createLogger('Drive');

export class DriveUploader {
  private drive: drive_v3.Drive | null = null;
  private readonly guildFolders = new Map<string, string>();

  constructor(
    private readonly credFile: string,
    private readonly rootFolderId: string,
  ) {}

  // ── Lazy auth ─────────────────────────────────────────────────────────

  private getService(): drive_v3.Drive {
    if (this.drive) return this.drive;
    const creds = JSON.parse(fs.readFileSync(path.resolve(this.credFile), 'utf-8'));
    const auth  = new JWT({
      email:  creds.client_email,
      key:    creds.private_key,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    this.drive = google.drive({ version: 'v3', auth });
    log.info('Authenticated with Google Drive.');
    return this.drive;
  }

  // ── Folder helpers ─────────────────────────────────────────────────────

  private async getOrCreateFolder(name: string, parentId?: string): Promise<string> {
    const drv = this.getService();
    const q = [
      `name='${name}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `trashed=false`,
      ...(parentId ? [`'${parentId}' in parents`] : []),
    ].join(' and ');

    const res = await drv.files.list({ q, fields: 'files(id)', spaces: 'drive' });
    const existing = res.data.files?.[0]?.id;
    if (existing) return existing;

    const created = await drv.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: 'id',
    });
    const id = created.data.id!;
    log.info(`Created Drive folder: ${name} (${id})`);
    return id;
  }

  private async guildFolder(guildName: string): Promise<string> {
    if (!this.guildFolders.has(guildName)) {
      const id = await this.getOrCreateFolder(
        `Discord Recordings – ${guildName}`,
        this.rootFolderId || undefined,
      );
      this.guildFolders.set(guildName, id);
    }
    return this.guildFolders.get(guildName)!;
  }

  // ── Upload ─────────────────────────────────────────────────────────────

  async upload(opts: {
    filePath:    string;
    guildName:   string;
    channelName: string;
    startedAt:   Date;
  }): Promise<string | null> {
    try {
      const drv = this.getService();

      const gFolder  = await this.guildFolder(opts.guildName);
      const dateStr  = opts.startedAt.toISOString().slice(0, 10);
      const dFolder  = await this.getOrCreateFolder(dateStr, gFolder);

      const uploaded = await drv.files.create({
        requestBody: { name: path.basename(opts.filePath), parents: [dFolder] },
        media: { mimeType: 'audio/wav', body: fs.createReadStream(opts.filePath) },
        fields: 'id,webViewLink',
      });

      // Make the file accessible to anyone with the link
      await drv.permissions.create({
        fileId:      uploaded.data.id!,
        requestBody: { type: 'anyone', role: 'reader' },
      });

      const link = uploaded.data.webViewLink ?? '';
      log.info(`Uploaded ${path.basename(opts.filePath)} → ${link}`);
      return link;
    } catch (err) {
      log.error(`Upload failed for ${opts.filePath}`, err);
      return null;
    }
  }
}
