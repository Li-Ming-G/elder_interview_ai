import { spawn } from 'node:child_process';

const apiEnvironment = {
  ...process.env,
  APP_ENV: 'local',
  // The existing Vite proxy and Owner runbook use the repository's local API port.
  API_PORT: '3101',
};
const webEnvironment = { ...process.env };
for (const key of [
  'AI_RETENTION_CLEANUP_PEPPER',
  'AUTH_LOGIN_THROTTLE_PEPPER',
  'DATABASE_URL',
  'OPENROUTER_API_KEY',
  'TEST_DATABASE_URL',
  'TENCENT_ASR_APP_ID',
  'TENCENT_ASR_SECRET_ID',
  'TENCENT_ASR_SECRET_KEY',
]) {
  delete webEnvironment[key];
}

const api = spawn(process.execPath, ['apps/api/dist/main.js', '--checkpoint-a'], {
  env: apiEnvironment,
  stdio: 'inherit',
});
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const web = spawn(
  pnpm,
  [
    '--filter',
    '@elder-interview/web',
    'exec',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    '5173',
    '--strictPort',
  ],
  { env: webEnvironment, stdio: 'inherit' },
);

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  api.kill('SIGTERM');
  web.kill('SIGTERM');
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const exitCode = await new Promise((resolve) => {
  let settled = false;
  const finish = (code) => {
    if (settled) return;
    settled = true;
    stop();
    resolve(typeof code === 'number' ? code : 1);
  };
  api.once('exit', (code) => finish(code));
  web.once('exit', (code) => finish(code));
});

process.exitCode = exitCode;
