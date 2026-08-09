import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new CommandFailure(result.status ?? 1);
}

class CommandFailure extends Error {
  constructor(exitCode) {
    super(`R4 child command failed with exit code ${String(exitCode)}`);
    this.exitCode = exitCode;
  }
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dev005r4-fake-audio-'));
const fakeAudioPath = join(temporaryDirectory, 'synthetic-interview.wav');
let exitCode = 0;
try {
  await writeFile(fakeAudioPath, createSyntheticInterviewWave());
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined) throw new Error('pnpm CLI path is unavailable');
  run(process.execPath, [pnpmCli, 'build']);
  run(
    process.execPath,
    [
      resolve('apps/api/node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--config',
      resolve('apps/api/prisma.config.ts'),
      '--schema',
      resolve('apps/api/prisma/schema.prisma'),
    ],
    { ...process.env, DATABASE_URL: databaseUrl },
  );
  run(process.execPath, [resolve('apps/api/dist/cli/seed-test-users.js')], {
    ...process.env,
    APP_ENV: 'test',
    DATABASE_URL: databaseUrl,
  });
  run(
    process.execPath,
    [
      resolve('node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      'playwright.r4.config.ts',
      ...process.argv.slice(2).filter((argument) => argument !== '--'),
    ],
    { ...process.env, DEV005R4_FAKE_AUDIO_PATH: fakeAudioPath },
  );
} catch (error) {
  if (error instanceof CommandFailure) exitCode = error.exitCode;
  else throw error;
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
process.exitCode = exitCode;

function createSyntheticInterviewWave() {
  const sampleRate = 48_000;
  const sampleCount = sampleRate * 6;
  const bytesPerSample = 2;
  const wave = Buffer.alloc(44 + sampleCount * bytesPerSample);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVE', 8);
  wave.write('fmt ', 12);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate * bytesPerSample, 28);
  wave.writeUInt16LE(bytesPerSample, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(sampleCount * bytesPerSample, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const timeSeconds = index / sampleRate;
    const amplitude = timeSeconds < 2 ? 0 : Math.sin(2 * Math.PI * 440 * timeSeconds) * 0.25;
    wave.writeInt16LE(Math.round(amplitude * 32_767), 44 + index * bytesPerSample);
  }
  return wave;
}
