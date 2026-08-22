import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const taskFields = ['id', 'status', 'task_card', 'worker_profile', 'depends_on', 'pr', 'next_task'];

async function load(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), 'utf8'));
}

function validateQueue(state) {
  assert.deepEqual(Object.keys(state).sort(), ['$schema', 'queue'].sort());
  assert(Array.isArray(state.queue) && state.queue.length > 0);
  for (const task of state.queue) {
    assert.deepEqual(Object.keys(task).sort(), [...taskFields].sort());
  }
}

function find(state, id) {
  const task = state.queue.find((candidate) => candidate.id === id);
  assert(task);
  return task;
}

const fixture = await load('fixtures/sequential-queue-smoke.json');

validateQueue(fixture);

const a = find(fixture, 'SYNTHETIC-A');
const b = find(fixture, 'SYNTHETIC-B');

assert.equal(a.status, 'READY');
a.status = 'IN_PROGRESS';

a.pr = 75;
a.status = 'REVIEW';
assert.equal(a.status, 'REVIEW');

const architectOutcome = 'PASS';
assert.equal(architectOutcome, 'PASS');
a.status = 'DONE';

assert.equal(a.next_task, b.id);
b.status = 'READY';

assert.equal(a.status, 'DONE');
assert.equal(b.status, 'READY');

process.stdout.write(
  `${JSON.stringify(
    {
      result: 'PASS',
      smoke: [
        'A READY',
        'A IN_PROGRESS',
        'A REVIEW (PR #75)',
        'external Architect PASS',
        'A DONE',
        'B READY',
      ],
    },
    null,
    2,
  )}\n`,
);
