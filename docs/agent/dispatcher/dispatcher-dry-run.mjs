import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

async function load(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), 'utf8'));
}

const requiredStateFields = [
  '$schema',
  'schema_version',
  'task_id',
  'status',
  'depends_on',
  'task_card',
  'worker_profile',
  'review_required',
  'next_task',
  'state_revision',
  'dispatch_run_id',
  'worker_thread_id',
  'pr_url',
  'review_outcome',
  'block_reason',
  'test_evidence',
  'evidence',
  'updated_at',
];

const statuses = new Set(['READY', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DEFERRED', 'DONE']);

function validateState(state) {
  assert.equal(state.schema_version, 'dispatcher-state-v1');
  assert.deepEqual(Object.keys(state).sort(), [...requiredStateFields].sort());
  assert(statuses.has(state.status));
  assert(Number.isInteger(state.state_revision) && state.state_revision >= 1);
  assert(Array.isArray(state.depends_on));
  assert(Array.isArray(state.test_evidence));
  assert(Array.isArray(state.evidence));
  if (state.status === 'BLOCKED' || state.status === 'DEFERRED') {
    assert.equal(typeof state.block_reason?.code, 'string');
    assert.equal(typeof state.block_reason?.message, 'string');
  }
  if (state.status === 'REVIEW') {
    assert.equal(state.review_outcome, 'PENDING');
    assert(state.test_evidence.length > 0);
    assert.match(state.pr_url, /^https:\/\//);
  }
}

function selectReady(tasks) {
  const ready = tasks.filter((task) => task.status === 'READY');
  assert.equal(ready.length, 1, 'fixture must produce one dispatch plan');
  return ready[0];
}

function claim(task) {
  assert.equal(task.status, 'READY');
  return {
    ...task,
    status: 'IN_PROGRESS',
    dispatch_run_id: 'dispatch-synthetic-001',
    worker_thread_id: 'synthetic-thread-luna-high',
  };
}

function completeWorker(task, result, syntheticMode = false) {
  assert.equal(task.status, 'IN_PROGRESS');
  assert(result.tests.length > 0, 'DISPATCH_TEST_EVIDENCE_MISSING');
  if (!syntheticMode) {
    assert.match(result.pr_url, /^https:\/\//, 'DISPATCH_PR_MISSING');
  } else {
    assert.equal(result.pr_url, 'SYNTHETIC');
  }
  return {
    ...task,
    status: 'REVIEW',
    test_evidence: result.tests,
    pr_url: result.pr_url,
    review_outcome: 'PENDING',
  };
}

function reviewStop(task) {
  assert.equal(task.status, 'REVIEW');
  return 'DISPATCH_REVIEW_GATE_STOP';
}

function applyPass(task, tasks) {
  assert.equal(task.status, 'REVIEW');
  const nextTasks = tasks.map((candidate) => ({ ...candidate }));
  const current = nextTasks.find((candidate) => candidate.task_id === task.task_id);
  assert(current);
  current.status = 'DONE';
  current.review_outcome = 'PASS';
  if (task.next_task !== null) {
    const next = nextTasks.find((candidate) => candidate.task_id === task.next_task);
    assert(next, 'DISPATCH_NEXT_TASK_UNDEFINED');
    assert.equal(next.status, 'DEFERRED');
    next.status = 'READY';
  }
  const changed = nextTasks
    .filter((candidate, index) => candidate.status !== tasks[index].status)
    .map((candidate) => candidate.task_id);
  assert.deepEqual(changed.sort(), [task.task_id, task.next_task].sort());
  return nextTasks;
}

function applyRequestChanges(task) {
  assert.equal(task.status, 'REVIEW');
  return {
    ...task,
    status: 'IN_PROGRESS',
    review_outcome: null,
    pr_url: null,
    test_evidence: [],
  };
}

const state = await load('dispatcher-state.json');
const schema = await load('dispatcher-state.schema.json');
const profile = await load('worker-profiles/luna-high.json');
const fixture = await load('fixtures/dispatcher-dry-run-v1.json');

validateState(state);
assert.deepEqual(schema.properties.status.enum, [...statuses]);
assert.equal(state.status, 'BLOCKED');
assert.equal(state.block_reason.code, 'GOVERNANCE_HANDOFF_RECONCILIATION_REQUIRED');

assert.equal(profile.worker_profile, fixture.profile_expectations.worker_profile);
assert.equal(profile.launch_arguments.model, fixture.profile_expectations.model);
assert.equal(profile.launch_arguments.thinking, fixture.profile_expectations.thinking);
assert.equal(profile.forbid_custom_agent_framework, true);
assert.equal(profile.verification.result.pr_url, 'SYNTHETIC');
assert.equal(profile.verification.evidence_class, 'SYNTHETIC_LAUNCH_CAPABILITY_ONLY');

const selected = selectReady(fixture.tasks);
assert.equal(selected.worker_profile, 'luna-high');
const claimed = claim(selected);
assert.throws(
  () =>
    completeWorker(
      claimed,
      { tests: ['synthetic_noop:NOT_APPLICABLE'], pr_url: 'SYNTHETIC' },
      false,
    ),
  /DISPATCH_PR_MISSING/,
);
const inReview = completeWorker(claimed, fixture.worker_result, false);
assert.equal(reviewStop(inReview), 'DISPATCH_REVIEW_GATE_STOP');

const fixtureAtReview = fixture.tasks.map((task) =>
  task.task_id === inReview.task_id ? { ...inReview } : { ...task },
);
const passed = applyPass(inReview, fixtureAtReview);
assert.equal(passed.find((task) => task.task_id === 'SYNTHETIC-READY-001').status, 'DONE');
assert.equal(passed.find((task) => task.task_id === 'SYNTHETIC-NEXT-001').status, 'READY');

const rework = applyRequestChanges(inReview);
assert.equal(rework.task_id, inReview.task_id);
assert.equal(rework.status, 'IN_PROGRESS');

assert.equal(fixture.negative_cases.find((item) => item.name === 'blocked_stop').expected, 'STOP');
assert.equal(
  fixture.negative_cases.find((item) => item.name === 'ambiguity_stop').expected,
  'DISPATCH_PRODUCT_AMBIGUITY',
);
assert.equal(
  fixture.negative_cases.find((item) => item.name === 'authority_conflict_stop').expected,
  'DISPATCH_AUTHORITY_CONFLICT',
);

const output = {
  result: 'PASS',
  current_state: {
    task_id: state.task_id,
    status: state.status,
    action: 'STOP',
    code: state.block_reason.code,
  },
  synthetic: {
    selected_task: selected.task_id,
    worker_profile: selected.worker_profile,
    launch: profile.launch_arguments,
    single_dispatch_plan: true,
    tests_and_https_pr_shape_to_review: true,
    synthetic_pr_rejected_for_real_review: true,
    transitions: fixture.expected_path,
    review_stop: true,
    pass_unlocks_only_predefined_next: true,
    request_changes_same_task: true,
    blocked_stop: true,
    ambiguity_stop: true,
    authority_conflict_stop: true,
  },
  native_verification: {
    ...fixture.native_launch_verification,
    warning:
      'The example.invalid PR shape and native SYNTHETIC PR/no-op are fixtures, not implementation or review evidence.',
  },
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
