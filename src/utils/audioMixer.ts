import fs from 'fs';
import path from 'path';
import { createLogger } from './logger';

const log = createLogger('AudioMixer');

const SAMPLE_RATE  = 48_000;
const NUM_CHANNELS = 2;
const BIT_DEPTH    = 16;
const BYTES_PER_SAMPLE = BIT_DEPTH / 8;  // 2

/**
 * Build a 44-byte WAV header for raw PCM data.
 */
function buildWavHeader(dataByteLength: number): Buffer {
  const hdr = Buffer.alloc(44);
  const byteRate  = SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = NUM_CHANNELS * BYTES_PER_SAMPLE;

  hdr.write('RIFF',  0, 'ascii');
  hdr.writeUInt32LE(36 + dataByteLength, 4);
  hdr.write('WAVE',  8, 'ascii');
  hdr.write('fmt ', 12, 'ascii');
  hdr.writeUInt32LE(16,          16);  // PCM sub-chunk size
  hdr.writeUInt16LE(1,           20);  // audio format = PCM
  hdr.writeUInt16LE(NUM_CHANNELS,22);
  hdr.writeUInt32LE(SAMPLE_RATE, 24);
  hdr.writeUInt32LE(byteRate,    28);
  hdr.writeUInt16LE(blockAlign,  32);
  hdr.writeUInt16LE(BIT_DEPTH,   34);
  hdr.write('data', 36, 'ascii');
  hdr.writeUInt32LE(dataByteLength, 40);
  return hdr;
}

/**
 * Mix every user's raw 16-bit signed LE stereo PCM buffer together,
 * clamp, and save as a WAV file.
 *
 * @param userBuffers  Map of userId → concatenated PCM chunks
 * @param outputPath   Where to write the .wav file
 */
export function mixAndSave(
  userBuffers: Map<string, Buffer>,
  outputPath: string,
): void {
  if (userBuffers.size === 0) {
    log.warn('No audio data captured – skipping WAV write.');
    return;
  }

  // Pad shorter buffers with silence so they're all the same length
  const arrays = [...userBuffers.values()];
  const maxLen  = Math.max(...arrays.map(b => b.byteLength));

  const padded = arrays.map(buf => {
    if (buf.byteLength >= maxLen) return buf;
    const p = Buffer.alloc(maxLen, 0);
    buf.copy(p);
    return p;
  });

  // Mix: sum int16 samples across all users, clamp to [-32768, 32767]
  const mixed = Buffer.alloc(maxLen);
  for (let i = 0; i + 1 < maxLen; i += BYTES_PER_SAMPLE) {
    let sum = 0;
    for (const buf of padded) sum += buf.readInt16LE(i);
    mixed.writeInt16LE(Math.max(-32768, Math.min(32767, sum)), i);
  }

  // Write WAV
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  const fd = fs.openSync(outputPath, 'w');
  fs.writeSync(fd, buildWavHeader(maxLen));
  fs.writeSync(fd, mixed);
  fs.closeSync(fd);

  const kb = (maxLen / 1024).toFixed(1);
  log.info(`WAV saved → ${outputPath} (${kb} KB PCM, ${userBuffers.size} user(s))`);
}
