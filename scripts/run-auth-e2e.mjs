import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

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
const forwarded = process.argv.slice(2).filter((argument) => argument !== '--');
run(process.execPath, [
  resolve('node_modules/@playwright/test/cli.js'),
  'test',
  '--config',
  'playwright.auth.config.ts',
  ...forwarded,
]);
