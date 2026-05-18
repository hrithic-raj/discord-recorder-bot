import fs from 'fs';

const FILE = 'bot_data.json';

interface Data { autoRecordChannels: string[] }

function load(): Data {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as Data;
  } catch { /* ignore */ }
  return { autoRecordChannels: [] };
}

function save(d: Data) {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
}

export function getAutoRecordChannels(): Set<string> {
  return new Set(load().autoRecordChannels);
}

export function addAutoRecordChannel(id: string) {
  const d = load();
  d.autoRecordChannels = [...new Set([...d.autoRecordChannels, id])];
  save(d);
}

export function removeAutoRecordChannel(id: string) {
  const d = load();
  d.autoRecordChannels = d.autoRecordChannels.filter(c => c !== id);
  save(d);
}
