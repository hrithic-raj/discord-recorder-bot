import fs from 'fs';

const logStream = fs.createWriteStream('bot.log', { flags: 'a' });

function write(level: string, tag: string, msg: string, extra?: unknown) {
  const line = `${new Date().toISOString()} [${level.padEnd(5)}] [${tag}] ${msg}${extra ? ' ' + String(extra) : ''}`;
  console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](line);
  logStream.write(line + '\n');
}

export function createLogger(tag: string) {
  return {
    info:  (msg: string)                  => write('INFO',  tag, msg),
    warn:  (msg: string)                  => write('WARN',  tag, msg),
    error: (msg: string, err?: unknown)   => write('ERROR', tag, msg, err),
  };
}
