import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCheckpointACommands,
  createCheckpointAEnvironments,
  terminateProcessTree,
} from './start-checkpoint-a.mjs';
import { migrateLocalDbPorts } from './migrate-local-db-ports.mjs';

async function withFixture(contents, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'elder-interview-local-operability-'));
  const filePath = join(directory, '.env.local');
  await writeFile(filePath, contents, 'utf8');
  try {
    return await callback(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const legacyEnv = [
  'DATABASE_URL=postgresql://owner:synthetic-password@127.0.0.1:5432/elder_interview_local',
  'TEST_DATABASE_URL=postgresql://test-owner:synthetic-test-password@127.0.0.1:5433/elder_interview_test',
  'OPENROUTER_API_KEY=synthetic-openrouter-secret',
  'TENCENT_ASR_SECRET_KEY=synthetic-tencent-secret',
  'CUSTOM_VALUE=preserve-this-byte-for-byte',
].join('\r\n');

test('migrates only legacy local DB ports and preserves unrelated values', async () => {
  await withFixture(legacyEnv, async (filePath) => {
    const result = await migrateLocalDbPorts(filePath);
    assert.deepEqual(result.changedKeys, ['DATABASE_URL', 'TEST_DATABASE_URL']);
    const migrated = await readFile(filePath, 'utf8');
    assert.match(migrated, /DATABASE_URL=.*127\.0\.0\.1:15432\/elder_interview_local/u);
    assert.match(migrated, /TEST_DATABASE_URL=.*127\.0\.0\.1:15433\/elder_interview_test/u);
    assert.match(migrated, /OPENROUTER_API_KEY=synthetic-openrouter-secret/u);
    assert.match(migrated, /TENCENT_ASR_SECRET_KEY=synthetic-tencent-secret/u);
    assert.match(migrated, /CUSTOM_VALUE=preserve-this-byte-for-byte/u);
  });
});

test('already migrated input is idempotent', async () => {
  const currentEnv = legacyEnv.replace(':5432/', ':15432/').replace(':5433/', ':15433/');
  await withFixture(currentEnv, async (filePath) => {
    const before = await readFile(filePath, 'utf8');
    const result = await migrateLocalDbPorts(filePath);
    assert.deepEqual(result.changedKeys, []);
    assert.equal(await readFile(filePath, 'utf8'), before);
  });
});

test('rejects ambiguous URLs without changing the fixture or exposing values', async () => {
  const ambiguous = legacyEnv.replace(
    '127.0.0.1:5432/elder_interview_local',
    'db.example.invalid:5432/elder_interview_local',
  );
  await withFixture(ambiguous, async (filePath) => {
    await assert.rejects(
      () => migrateLocalDbPorts(filePath),
      (error) => {
        assert.match(error.message, /^DATABASE_URL:/u);
        assert.doesNotMatch(error.message, /db\.example|synthetic-password|elder_interview_local/u);
        return true;
      },
    );
    assert.equal(await readFile(filePath, 'utf8'), ambiguous);
  });
});

test('reports a missing .env.local without reading or printing secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'elder-interview-local-operability-missing-'));
  try {
    await assert.rejects(
      () => migrateLocalDbPorts(join(directory, '.env.local')),
      /\.env\.local: file not found/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses direct Node entrypoints for API and Vite on every platform', () => {
  const commands = createCheckpointACommands('C:\\repo');
  assert.equal(commands.api.command, process.execPath);
  assert.deepEqual(commands.api.arguments.slice(-1), ['--checkpoint-a']);
  assert.equal(commands.web.command, process.execPath);
  assert.match(
    commands.web.arguments[0],
    /apps[\\/]web[\\/]node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/u,
  );
  assert.deepEqual(commands.web.arguments.slice(-3), ['--port', '5173', '--strictPort']);
  assert.ok(!commands.web.command.endsWith('.cmd'));
});

test('keeps backend-only secrets out of the Vite child environment', () => {
  const { apiEnvironment, webEnvironment } = createCheckpointAEnvironments({
    DATABASE_URL: 'synthetic-db-url',
    TEST_DATABASE_URL: 'synthetic-test-db-url',
    OPENROUTER_API_KEY: 'synthetic-openrouter-secret',
    TENCENT_ASR_SECRET_KEY: 'synthetic-tencent-secret',
    PUBLIC_FLAG: 'preserved',
  });
  assert.equal(apiEnvironment.DATABASE_URL, 'synthetic-db-url');
  assert.equal(apiEnvironment.OPENROUTER_API_KEY, 'synthetic-openrouter-secret');
  assert.equal(webEnvironment.PUBLIC_FLAG, 'preserved');
  for (const key of [
    'DATABASE_URL',
    'TEST_DATABASE_URL',
    'OPENROUTER_API_KEY',
    'TENCENT_ASR_SECRET_KEY',
  ]) {
    assert.equal(webEnvironment[key], undefined);
  }
});

test('uses Windows tree termination for launcher shutdown', () => {
  const calls = [];
  const child = { pid: 4242, exitCode: null };
  terminateProcessTree(child, 'win32', (command, arguments_, options) => {
    calls.push({ command, arguments_, options });
    return {};
  });
  assert.deepEqual(calls, [
    {
      command: 'taskkill.exe',
      arguments_: ['/PID', '4242', '/T', '/F'],
      options: { stdio: 'ignore', windowsHide: true },
    },
  ]);
});
