import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ONLY_KEYS = [
  'AI_RETENTION_CLEANUP_PEPPER',
  'AUTH_LOGIN_THROTTLE_PEPPER',
  'DATABASE_URL',
  'OPENROUTER_API_KEY',
  'TEST_DATABASE_URL',
  'TENCENT_ASR_APP_ID',
  'TENCENT_ASR_SECRET_ID',
  'TENCENT_ASR_SECRET_KEY',
];

export function createCheckpointAEnvironments(sourceEnvironment = process.env) {
  const apiEnvironment = {
    ...sourceEnvironment,
    APP_ENV: 'local',
    // The existing Vite proxy and Owner runbook use the repository's local API port.
    API_PORT: '3101',
  };
  const webEnvironment = { ...sourceEnvironment };
  for (const key of SERVER_ONLY_KEYS) delete webEnvironment[key];
  return { apiEnvironment, webEnvironment };
}

export function createCheckpointACommands(repositoryRoot = process.cwd()) {
  return {
    api: {
      command: process.execPath,
      arguments: [resolve(repositoryRoot, 'apps/api/dist/main.js'), '--checkpoint-a'],
    },
    web: {
      command: process.execPath,
      cwd: resolve(repositoryRoot, 'apps/web'),
      // Calling Vite through its Node entrypoint works on Windows and POSIX without
      // invoking a package-manager .cmd/.sh wrapper as a child process.
      arguments: [
        resolve(repositoryRoot, 'apps/web/node_modules/vite/bin/vite.js'),
        '--host',
        '127.0.0.1',
        '--port',
        '5173',
        '--strictPort',
      ],
    },
  };
}

export function createCheckpointAProcessOptions(command, environment) {
  return {
    ...(command.cwd ? { cwd: command.cwd } : {}),
    env: environment,
    stdio: 'inherit',
  };
}

export function terminateProcessTree(child, platform = process.platform, spawnProcess = spawn) {
  if (typeof child?.pid !== 'number' || child.exitCode !== null) return;
  if (platform === 'win32') {
    // taskkill.exe is a real executable, so this avoids the .cmd launch issue and
    // /T ensures descendants do not survive a launcher shutdown.
    spawnProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
}

async function main() {
  const { apiEnvironment, webEnvironment } = createCheckpointAEnvironments();
  const commands = createCheckpointACommands();

  const api = spawn(
    commands.api.command,
    commands.api.arguments,
    createCheckpointAProcessOptions(commands.api, apiEnvironment),
  );
  const web = spawn(
    commands.web.command,
    commands.web.arguments,
    createCheckpointAProcessOptions(commands.web, webEnvironment),
  );

  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    terminateProcessTree(api);
    terminateProcessTree(web);
  }

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const exitCode = await new Promise((resolveExitCode) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      stop();
      resolveExitCode(typeof code === 'number' ? code : 1);
    };
    api.once('error', () => finish(1));
    web.once('error', () => finish(1));
    api.once('exit', (code) => finish(code));
    web.once('exit', (code) => finish(code));
  });

  process.exitCode = exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
