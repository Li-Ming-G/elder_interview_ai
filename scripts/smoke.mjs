import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const apiPort = Number(process.env.SMOKE_API_PORT ?? 3100);
const webPort = Number(process.env.SMOKE_WEB_PORT ?? 4173);
const webRoot = resolve('apps/web/dist');
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://elder_interview_test:local_test_only@127.0.0.1:15433/elder_interview_test';

function waitForExit(child) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveExit) => child.once('close', resolveExit));
}

async function terminateChild(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill();
  const exited = await Promise.race([
    waitForExit(child).then(() => true),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(false), 5_000)),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
    await waitForExit(child);
  }
}

function runProcess(command, arguments_, environment) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, arguments_, {
      cwd: resolve('.'),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      void terminateChild(child).then(() => rejectProcess(new Error('Child process timed out')));
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectProcess(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolveProcess({ code, stderr, stdout });
    });
  });
}

async function expectMissingConfigFailure() {
  const marker = 'must-not-appear-in-startup-output';
  const environment = {
    ...process.env,
    APP_ENV: 'test',
    AUTH_ALLOWED_ORIGINS: `http://127.0.0.1:${String(webPort)}`,
    AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
    AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
    DATABASE_URL: undefined,
    SECRET_SMOKE_MARKER: marker,
  };
  delete environment.DATABASE_URL;

  const result = await runProcess(process.execPath, ['apps/api/dist/main.js'], environment);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0 || !output.includes('CONFIG_INVALID') || output.includes(marker)) {
    throw new Error('Missing configuration did not fail safely');
  }
}

async function fetchUntil(url, predicate, label) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.text();
        if (predicate(body, response)) {
          return body;
        }
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, Math.min(100 + attempt * 25, 500)),
    );
  }
  throw new Error(`${label} did not become ready: ${String(lastError ?? 'unexpected response')}`);
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

async function serveStatic(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolve(webRoot, relativePath);
  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': contentType(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}

function referencedAssets(html) {
  const matches = html.matchAll(
    /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\.(?:css|js)(?:\?[^"']*)?)["']/giu,
  );
  return [...new Set([...matches].map((match) => match[1]))];
}

function closeServer(server) {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
  });
}

await expectMissingConfigFailure();

const webServer = createServer((request, response) => {
  void serveStatic(request, response);
});
const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
  cwd: resolve('.'),
  env: {
    ...process.env,
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    APP_ENV: 'test',
    AUTH_ALLOWED_ORIGINS: `http://127.0.0.1:${String(webPort)}`,
    AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
    AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: 'error',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let apiStderr = '';
api.stdout.on('data', () => undefined);
api.stderr.on('data', (chunk) => {
  apiStderr += String(chunk);
});

try {
  await new Promise((resolveListen, rejectListen) => {
    webServer.once('error', rejectListen);
    webServer.listen(webPort, '127.0.0.1', resolveListen);
  });
  const [html] = await Promise.all([
    fetchUntil(
      `http://127.0.0.1:${webPort}`,
      (body, response) =>
        body.includes('/assets/') && response.headers.get('content-type')?.startsWith('text/html'),
      'Web build',
    ),
    fetchUntil(
      `http://127.0.0.1:${apiPort}/api/v1/health`,
      (body) => body.includes('"database":"up"') && body.includes('"status":"ok"'),
      'API and database',
    ),
  ]);
  const assets = referencedAssets(html);
  if (assets.length === 0) {
    throw new Error('Web build HTML did not reference JavaScript or CSS assets');
  }
  await Promise.all(
    assets.map((asset) =>
      fetchUntil(
        new URL(asset, `http://127.0.0.1:${webPort}`).toString(),
        (body) => body.length > 0,
        `Web asset ${asset}`,
      ),
    ),
  );
  process.stdout.write(`Web/API/PostgreSQL smoke passed (${assets.length} assets fetched)\n`);
} catch (error) {
  if (apiStderr.length > 0) {
    process.stderr.write(apiStderr);
  }
  throw error;
} finally {
  await terminateChild(api);
  await closeServer(webServer);
}
