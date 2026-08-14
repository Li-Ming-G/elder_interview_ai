import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const action = process.argv[2];
const pcmPath = process.env.ASR_ANDROID_PCM_PATH;
const wavePath = process.env.ASR_ANDROID_WAVE_PATH;
if (pcmPath === undefined || wavePath === undefined) {
  throw new Error('ANDROID_ASR_AUDIO_PATH_MISSING');
}

if (action === 'prepare') {
  const pcm = await readFile(pcmPath);
  if (pcm.length !== 15_164_800) throw new Error('ANDROID_ASR_PCM_IDENTITY_MISMATCH');
  const wave = Buffer.allocUnsafe(44 + pcm.length);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVE', 8);
  wave.write('fmt ', 12);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(16_000, 24);
  wave.writeUInt32LE(32_000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(pcm.length, 40);
  pcm.copy(wave, 44);
  await writeFile(wavePath, wave);
  process.stdout.write(
    `${JSON.stringify({
      durationSeconds: pcm.length / 32_000,
      hashPrefix: createHash('sha256').update(pcm).digest('hex').slice(0, 8).toUpperCase(),
      prepared: true,
    })}\n`,
  );
} else if (action === 'play') {
  const escapedPath = wavePath.replaceAll("'", "''");
  const command = `$player = New-Object System.Media.SoundPlayer('${escapedPath}'); $player.PlaySync()`;
  const player = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  player.unref();
  process.stdout.write(`${JSON.stringify({ playbackPid: player.pid, started: true })}\n`);
} else {
  throw new Error('Expected prepare or play');
}
