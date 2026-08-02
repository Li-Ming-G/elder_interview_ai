import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const apiRoot = resolve('apps/api');
const prismaCli = resolve(apiRoot, 'node_modules/prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaCli, 'generate'], {
  cwd: apiRoot,
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://generate:generate@127.0.0.1:1/generate',
  },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error !== undefined) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
