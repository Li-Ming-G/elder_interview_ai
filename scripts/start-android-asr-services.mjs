import { closeSync, mkdirSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { loadApiConfig } from '../packages/config/dist/index.js';

const config = loadApiConfig(process.env);
if (config.asr.provider !== 'tencent_realtime_asr_v2') {
  throw new Error('ANDROID_ASR_PROVIDER_INVALID');
}

const runRoot = join(tmpdir(), 'asr-android-run-001');
mkdirSync(runRoot, { recursive: true });

function start(label, arguments_) {
  const stdout = openSync(join(runRoot, `${label}.stdout.log`), 'a');
  const stderr = openSync(join(runRoot, `${label}.stderr.log`), 'a');
  try {
    const child = spawn(process.execPath, arguments_, {
      cwd: resolve('.'),
      detached: true,
      env: process.env,
      stdio: ['ignore', stdout, stderr],
      windowsHide: true,
    });
    child.unref();
    return child.pid;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

const apiPid = start('api', ['apps/api/dist/main.js']);
const webPid = start('web', [
  'apps/web/node_modules/vite/bin/vite.js',
  'preview',
  'apps/web',
  '--host',
  '127.0.0.1',
  '--port',
  '4176',
  '--strictPort',
]);

let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const [api, web] = await Promise.all([
      fetch('http://127.0.0.1:3101/api/v1/health'),
      fetch('http://127.0.0.1:4176/'),
    ]);
    if (api.ok && web.ok) {
      ready = true;
      break;
    }
  } catch {
    // Bounded readiness polling; child logs remain private in the temporary directory.
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
}

if (!ready) {
  for (const pid of [apiPid, webPid]) {
    try {
      process.kill(pid);
    } catch {
      // Already exited.
    }
  }
  throw new Error('ANDROID_ASR_SERVICES_NOT_READY');
}

process.stdout.write(
  `${JSON.stringify({
    apiPid,
    configValid: true,
    engine: config.asr.engineModelType,
    provider: config.asr.provider,
    ready,
    webPid,
  })}\n`,
);
