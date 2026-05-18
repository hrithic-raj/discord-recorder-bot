# 🎙️ Discord Voice Recorder Bot (TypeScript)

Records voice channel meetings and uploads them automatically to Google Drive.

> **v3 — fixes all TypeScript build errors compatibility**  
> Replaced `@discordjs/opus` (requires C++ compilation) with `opusscript` (pure JavaScript).  
> Replaced `sodium-native` (native) with `tweetnacl` (pure JavaScript).  
> No build tools, no Python, no Visual Studio required.

---

## ✨ Features

- 🔴 `/startrecording` — record any voice channel on demand
- 🤖 Auto-record channels — starts when 2+ users join, stops when they leave
- 🎛️ Multiple VCs recorded at the same time
- ☁️ Uploads to Google Drive (organized by server → date)
- 👥 Participant tracking per recording
- ⏱️ Watchdog auto-stops runaway recordings

---

## 📋 Commands

| Command | Permissions | Description |
|---|---|---|
| `/startrecording [channel]` | Everyone | Start recording a VC |
| `/stoprecording [channel]` | Everyone | Stop recording a VC |
| `/recordingstatus` | Everyone | Show active recordings |
| `/addautochannel` | Manage Server | Mark a VC for auto-recording |
| `/removeautochannel` | Manage Server | Remove auto-recording from a VC |
| `/listautochannels` | Everyone | List auto-record channels |

---

## 🚀 Step-by-Step Setup

### Step 1 — Install Node.js

Download **Node.js 18 or 20 LTS** (recommended) from https://nodejs.org  
*(Node 24 works too — this version is compatible.)*

Open a terminal and verify:
```
node --version    ← should say v18, v20, or v22+
npm --version
```

---

### Step 2 — Install FFmpeg

**Windows:**
1. Go to https://www.gyan.dev/ffmpeg/builds/ → download `ffmpeg-release-essentials.zip`
2. Extract it → go inside → copy the `bin` folder path  
   e.g. `C:\ffmpeg\bin`
3. Open Start → search "Environment Variables" → Edit System Environment Variables  
4. Click **Environment Variables** → under System Variables find **Path** → Edit → New  
5. Paste `C:\ffmpeg\bin` → OK → OK → OK
6. Open a **new** terminal and run `ffmpeg -version` to confirm

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt update && sudo apt install ffmpeg
```

---

### Step 3 — Create Your Discord Bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → give it a name (e.g. "Recorder Bot") → **Create**
3. On the left sidebar, click **Bot**
4. Click **Add Bot** → **Yes, do it!**
5. Under **Token**, click **Reset Token** → copy the token → save it somewhere safe  
   ⚠️ You can only see this once. If you lose it, reset it again.
6. Scroll down to **Privileged Gateway Intents** — turn ON all three:
   - ✅ Presence Intent
   - ✅ Server Members Intent
   - ✅ Message Content Intent
7. Click **Save Changes**

**Get your Application ID:**
- Click **General Information** on the left sidebar
- Copy the **Application ID** (also called Client ID)

**Invite the bot to your server:**
1. Click **OAuth2** → **URL Generator** on the left sidebar
2. Under **Scopes**, tick: `bot` and `applications.commands`
3. Under **Bot Permissions**, tick:
   - Connect
   - Speak
   - Use Voice Activity
   - Send Messages
   - Embed Links
   - Read Message History
4. Scroll down — copy the generated URL
5. Open the URL in your browser → select your server → **Authorize**

---

### Step 4 — Set Up Google Drive

1. Go to https://console.cloud.google.com
2. At the top, click the project dropdown → **New Project**  
   Give it a name (e.g. "Discord Recorder") → **Create**
3. Make sure your new project is selected in the dropdown
4. In the search bar, type **"Google Drive API"** → click it → **Enable**
5. On the left sidebar, click **IAM & Admin** → **Service Accounts**
6. Click **+ Create Service Account**  
   - Name: `discord-recorder` → **Create and Continue** → **Done**
7. Click on the service account you just created
8. Go to the **Keys** tab → **Add Key** → **Create new key** → **JSON** → **Create**
9. A `.json` file downloads automatically  
   **Rename it to `credentials.json`** and move it into your project folder

---

### Step 5 — Configure the Bot

In your project folder, copy the example config:

**Windows (Command Prompt):**
```
copy .env.example .env
```

**macOS / Linux:**
```bash
cp .env.example .env
```

Open `.env` in Notepad (or any text editor) and fill in:

```
DISCORD_TOKEN=paste_your_bot_token_here
DISCORD_CLIENT_ID=paste_your_application_id_here
GOOGLE_CREDENTIALS_FILE=credentials.json
GOOGLE_DRIVE_FOLDER_ID=         ← leave blank (recordings go to Drive root)
RECORDINGS_DIR=./recordings
MAX_RECORDING_HOURS=6
```

Make sure `credentials.json` is in the same folder as `package.json`.

---

### Step 6 — Install & Build

Open a terminal in the project folder and run:

```bash
npm install --legacy-peer-deps
npm run build
```

You should see no errors. A `dist/` folder will appear.

---

### Step 7 — Register Slash Commands (once)

```bash
npm run deploy-commands
```

You'll see: `✅ Done! Commands may take up to 1 hour to appear globally.`

> To see commands instantly, go to your server settings and re-invite the bot using the OAuth2 URL.

---

### Step 8 — Start the Bot

```bash
npm start
```

The terminal will print something like:
```
✅ Logged in as Recorder Bot#1234
```

Your bot is now online! Try joining a voice channel and typing `/startrecording`.

---

## 🔧 Troubleshooting

**`npm install` fails with "Python not found" or "build error"**  
→ You may have an older version of this project. Make sure you're using **v2** (this zip).  
→ v2 uses `opusscript` — no Python or build tools needed.

**Bot doesn't join the voice channel**  
→ Check that the bot has **Connect** and **Use Voice Activity** permissions in that VC.

**Recording file is empty / no audio**  
→ Make sure you're using Node 18+. Run `node --version` to check.  
→ Try rejoining the voice channel yourself after the bot connects.

**Google Drive upload fails**  
→ Open `bot.log` and look for the error message.  
→ Double-check that `credentials.json` is in the project folder.  
→ Make sure **Google Drive API** is enabled in your Google Cloud project.

**Slash commands don't appear**  
→ Wait up to 1 hour after running `npm run deploy-commands`.  
→ Try kicking and re-inviting the bot using a fresh OAuth2 URL.

**"Missing required env var" error on startup**  
→ Open `.env` and confirm `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` are filled in (no quotes needed).

---

## 🔄 Running 24/7 (Optional)

Install PM2 to keep the bot running in the background:

```bash
npm install -g pm2
pm2 start dist/index.js --name recorder-bot
pm2 save
pm2 startup    ← follow the printed instruction to auto-start on reboot
```

---

## 📁 Drive Folder Structure

```
My Drive/
└── Discord Recordings – Your Server Name/
    └── 2025-06-01/
        ├── General_2025-06-01T14-00-00.wav
        └── Meeting-Room_2025-06-01T16-30-00.wav
```

---

## 🗂️ Project Layout

```
src/
├── index.ts                   Main entry point
├── config.ts                  Reads .env settings
├── deploy-commands.ts         One-time slash command registration
├── commands/
│   ├── types.ts               BotCommand interface
│   ├── startRecording.ts      /startrecording
│   ├── stopRecording.ts       /stoprecording
│   ├── recordingStatus.ts     /recordingstatus
│   └── autoChannels.ts        /addautochannel, /removeautochannel, /listautochannels
├── events/
│   └── voiceStateUpdate.ts    Auto-record trigger
└── utils/
    ├── recordingManager.ts    Core recording logic
    ├── audioMixer.ts          Mixes PCM → WAV (no native deps)
    ├── driveUploader.ts       Google Drive upload
    ├── storage.ts             Persists auto-record channel list
    └── logger.ts              Console + file logging
```
