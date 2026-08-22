import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const statuses = new Set(['READY', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DEFERRED', 'DONE']);
const stateFields = [
  '$schema',
  'schema_version',
  'state_revision',
  'current_task_id',
  'tasks',
  'review_history',
  'updated_at',
];
const taskFields = [
  'task_id',
  'status',
  'depends_on',
  'task_card',
  'worker_profile',
  'review_required',
  'next_task',
  'dispatch_run_id',
  'worker_thread_id',
  'pull_request',
  'test_evidence',
  'review_evidence',
  'block_reason',
  'evidence',
];

async function load(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), 'utf8'));
}

function fail(code) {
  throw new Error(code);
}

function clone(value) {
  return structuredClone(value);
}

function validatePullRequest(pr) {
  if (pr === null || typeof pr !== 'object') fail('DISPATCH_PR_MISSING');
  if (pr.owner !== 'Li-Ming-G' || pr.repo !== 'elder_interview_ai') {
    fail('DISPATCH_PR_REPOSITORY_MISMATCH');
  }
  if (!Number.isInteger(pr.number) || pr.number < 1) fail('DISPATCH_PR_MISSING');
  const expectedUrl = `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
  if (pr.url !== expectedUrl || pr.url.includes('example.invalid')) {
    fail('DISPATCH_PR_REPOSITORY_MISMATCH');
  }
  if (!/^[a-f0-9]{40}$/.test(pr.head_sha)) fail('DISPATCH_PR_HEAD_MISMATCH');
}

function validateTests(tests, headSha) {
  if (!Array.isArray(tests) || tests.length === 0) fail('DISPATCH_TEST_EVIDENCE_MISSING');
  for (const item of tests) {
    if (
      !['command', 'ci'].includes(item?.kind) ||
      item.status !== 'PASS' ||
      typeof item.name !== 'string' ||
      item.name.length === 0 ||
      typeof item.url_or_id !== 'string' ||
      item.url_or_id.length === 0
    ) {
      fail('DISPATCH_TEST_EVIDENCE_INVALID');
    }
    if (
      (item.kind === 'ci' &&
        !/^https:\/\/github\.com\/Li-Ming-G\/elder_interview_ai\/actions\/runs\/[1-9][0-9]*$/.test(
          item.url_or_id,
        )) ||
      (item.kind === 'command' && !/^command:[A-Za-z0-9._:/ -]{1,450}$/.test(item.url_or_id))
    ) {
      fail('DISPATCH_TEST_EVIDENCE_INVALID');
    }
    if (item.head_sha !== headSha) fail('DISPATCH_PR_HEAD_MISMATCH');
  }
}

function validateReview(review, headSha) {
  if (review === null || typeof review !== 'object') fail('DISPATCH_REVIEW_EVIDENCE_MISSING');
  if (
    typeof review.reviewer_identity !== 'string' ||
    review.reviewer_identity.length === 0 ||
    typeof review.review_url_or_id !== 'string' ||
    review.review_url_or_id.length === 0
  ) {
    fail('DISPATCH_REVIEW_EVIDENCE_MISSING');
  }
  if (
    !/^(https:\/\/github\.com\/Li-Ming-G\/elder_interview_ai\/pull\/[1-9][0-9]*(#pullrequestreview-[1-9][0-9]*|\/reviews\/[1-9][0-9]*)?|codex-thread:[A-Za-z0-9._:-]{1,450})$/.test(
      review.review_url_or_id,
    )
  ) {
    fail('DISPATCH_REVIEW_EVIDENCE_INVALID');
  }
  if (!['PASS', 'REQUEST_CHANGES', 'BLOCKED', 'PRODUCT_AMBIGUITY'].includes(review.outcome)) {
    fail('DISPATCH_REVIEW_OUTCOME_INVALID');
  }
  if (review.reviewed_head_sha !== headSha) fail('DISPATCH_REVIEW_HEAD_STALE');
  for (const severity of ['p0', 'p1', 'p2']) {
    if (!Number.isInteger(review.findings?.[severity]) || review.findings[severity] < 0) {
      fail('DISPATCH_REVIEW_EVIDENCE_MISSING');
    }
  }
}

function validateState(state) {
  assert.deepEqual(Object.keys(state).sort(), [...stateFields].sort());
  assert(
    ['./dispatcher-state.schema.json', '../dispatcher-state.schema.json'].includes(state.$schema),
  );
  assert.equal(state.schema_version, 'dispatcher-state-v2');
  assert(Number.isInteger(state.state_revision) && state.state_revision >= 1);
  assert(Array.isArray(state.tasks) && state.tasks.length > 0);
  assert(Array.isArray(state.review_history));

  const taskIds = new Set();
  for (const task of state.tasks) {
    assert.deepEqual(Object.keys(task).sort(), [...taskFields].sort());
    if (taskIds.has(task.task_id)) fail('DISPATCH_TASK_ID_DUPLICATE');
    taskIds.add(task.task_id);
    assert(statuses.has(task.status));
    if (task.review_required !== true) fail('DISPATCH_REVIEW_REQUIRED');
    assert(Array.isArray(task.depends_on));
    assert(Array.isArray(task.test_evidence));
    assert(Array.isArray(task.evidence));

    if (task.status === 'READY') {
      assert.equal(task.dispatch_run_id, null);
      assert.equal(task.worker_thread_id, null);
      assert.equal(task.pull_request, null);
      assert.deepEqual(task.test_evidence, []);
      assert.equal(task.review_evidence, null);
      assert.equal(task.block_reason, null);
    } else if (task.status === 'IN_PROGRESS') {
      assert.match(task.dispatch_run_id, /^dispatch-/);
      assert.equal(typeof task.worker_thread_id, 'string');
      assert.equal(task.pull_request, null);
      assert.deepEqual(task.test_evidence, []);
      assert.equal(task.review_evidence, null);
      assert.equal(task.block_reason, null);
    } else if (task.status === 'REVIEW') {
      validatePullRequest(task.pull_request);
      validateTests(task.test_evidence, task.pull_request.head_sha);
      assert.equal(task.review_evidence, null);
      assert.equal(task.block_reason, null);
    } else if (task.status === 'DONE') {
      validatePullRequest(task.pull_request);
      validateTests(task.test_evidence, task.pull_request.head_sha);
      validateReview(task.review_evidence, task.pull_request.head_sha);
      assert.equal(task.review_evidence.outcome, 'PASS');
      assert.equal(task.block_reason, null);
    } else {
      assert.equal(task.dispatch_run_id, null);
      assert.equal(task.worker_thread_id, null);
      assert.equal(task.pull_request, null);
      assert.deepEqual(task.test_evidence, []);
      assert.equal(task.review_evidence, null);
      assert.equal(typeof task.block_reason?.code, 'string');
      assert.equal(typeof task.block_reason?.message, 'string');
    }
  }

  if (!taskIds.has(state.current_task_id)) fail('DISPATCH_CURRENT_TASK_UNDEFINED');
  for (const task of state.tasks) {
    if (task.next_task !== null && !taskIds.has(task.next_task))
      fail('DISPATCH_NEXT_TASK_UNDEFINED');
  }
  for (const entry of state.review_history) {
    validatePullRequest(entry.pull_request);
    validateTests(entry.test_evidence, entry.pull_request.head_sha);
    validateReview(entry.review_evidence, entry.pull_request.head_sha);
  }
}

function writeTransition(state, expectedStateRevision, mutate) {
  if (expectedStateRevision !== state.state_revision) fail('DISPATCH_STALE_STATE_REVISION');
  const next = clone(state);
  mutate(next);
  next.state_revision = state.state_revision + 1;
  validateState(next);
  assert.equal(next.state_revision, state.state_revision + 1);
  return next;
}

function selectReady(state) {
  const ready = state.tasks.filter((task) => task.status === 'READY');
  if (ready.length === 0) fail('DISPATCH_NO_READY_TASK');
  if (ready.length > 1) fail('DISPATCH_MULTIPLE_READY_TASKS');
  return ready[0];
}

function taskById(state, taskId) {
  const task = state.tasks.find((item) => item.task_id === taskId);
  if (!task) fail('DISPATCH_TASK_UNDEFINED');
  return task;
}

function claim(state, expectedStateRevision, input) {
  if (expectedStateRevision !== state.state_revision) fail('DISPATCH_STALE_STATE_REVISION');
  if (taskById(state, input.task_id).status !== 'READY') fail('DISPATCH_ALREADY_CLAIMED');
  const selected = selectReady(state);
  if (selected.task_id !== input.task_id) fail('DISPATCH_ALREADY_CLAIMED');
  return writeTransition(state, expectedStateRevision, (next) => {
    const task = taskById(next, input.task_id);
    if (task.status !== 'READY') fail('DISPATCH_ALREADY_CLAIMED');
    task.status = 'IN_PROGRESS';
    task.dispatch_run_id = input.dispatch_run_id;
    task.worker_thread_id = input.worker_thread_id;
  });
}

function completeWorker(state, expectedStateRevision, input) {
  return writeTransition(state, expectedStateRevision, (next) => {
    const task = taskById(next, input.task_id);
    if (task.status !== 'IN_PROGRESS') fail('DISPATCH_TRANSITION_INVALID');
    if (
      task.dispatch_run_id !== input.dispatch_run_id ||
      task.worker_thread_id !== input.worker_thread_id
    ) {
      fail('DISPATCH_LATE_WORKER_COMPLETION');
    }
    validatePullRequest(input.pull_request);
    validateTests(input.test_evidence, input.pull_request.head_sha);
    task.status = 'REVIEW';
    task.pull_request = clone(input.pull_request);
    task.test_evidence = clone(input.test_evidence);
  });
}

function blockTask(state, expectedStateRevision, taskId, code) {
  return writeTransition(state, expectedStateRevision, (next) => {
    const task = taskById(next, taskId);
    if (!['READY', 'IN_PROGRESS', 'REVIEW'].includes(task.status)) {
      fail('DISPATCH_TRANSITION_INVALID');
    }
    task.status = 'BLOCKED';
    task.dispatch_run_id = null;
    task.worker_thread_id = null;
    task.pull_request = null;
    task.test_evidence = [];
    task.review_evidence = null;
    task.block_reason = {
      code,
      message: 'Deterministic stop: external correction is required.',
    };
  });
}

function reviewStop(state, taskId) {
  if (taskById(state, taskId).status !== 'REVIEW') fail('DISPATCH_TRANSITION_INVALID');
  return 'DISPATCH_REVIEW_GATE_STOP';
}

function applyReview(state, expectedStateRevision, taskId, review, reworkClaim = null) {
  return writeTransition(state, expectedStateRevision, (next) => {
    const task = taskById(next, taskId);
    if (task.status !== 'REVIEW') fail('DISPATCH_TRANSITION_INVALID');
    if (task.review_required !== true) fail('DISPATCH_REVIEW_REQUIRED');
    validatePullRequest(task.pull_request);
    validateTests(task.test_evidence, task.pull_request.head_sha);
    validateReview(review, task.pull_request.head_sha);
    next.review_history.push({
      task_id: task.task_id,
      pull_request: clone(task.pull_request),
      test_evidence: clone(task.test_evidence),
      review_evidence: clone(review),
    });

    if (review.outcome === 'PASS') {
      task.status = 'DONE';
      task.review_evidence = clone(review);
      if (task.next_task !== null) {
        const following = taskById(next, task.next_task);
        if (following.status !== 'DEFERRED') fail('DISPATCH_NEXT_TASK_UNDEFINED');
        following.status = 'READY';
        following.block_reason = null;
      }
      return;
    }

    if (review.outcome === 'REQUEST_CHANGES') {
      if (reworkClaim === null) fail('DISPATCH_REWORK_CLAIM_MISSING');
      task.status = 'IN_PROGRESS';
      task.dispatch_run_id = reworkClaim.dispatch_run_id;
      task.worker_thread_id = reworkClaim.worker_thread_id;
      task.pull_request = null;
      task.test_evidence = [];
      task.review_evidence = null;
      return;
    }

    task.status = 'BLOCKED';
    task.dispatch_run_id = null;
    task.worker_thread_id = null;
    task.pull_request = null;
    task.test_evidence = [];
    task.review_evidence = null;
    task.block_reason = {
      code:
        review.outcome === 'PRODUCT_AMBIGUITY'
          ? 'DISPATCH_PRODUCT_AMBIGUITY'
          : 'DISPATCH_REVIEW_BLOCKED',
      message: 'External review requires a decision before work can continue.',
    };
  });
}

const state = await load('dispatcher-state.json');
const schema = await load('dispatcher-state.schema.json');
const profile = await load('worker-profiles/luna-high.json');
const fixture = await load('fixtures/dispatcher-dry-run-v2.json');

validateState(state);
validateState(fixture);
assert.equal(schema.title, 'Dispatcher State V2');
assert.equal(schema.$defs.task.properties.review_required.const, true);
assert.equal(profile.worker_profile, 'luna-high');
assert.deepEqual(profile.launch_arguments, { model: 'gpt-5.6-luna', thinking: 'high' });
assert.equal(profile.forbid_custom_agent_framework, true);
assert.equal(profile.verification.evidence_class, 'SYNTHETIC_LAUNCH_CAPABILITY_ONLY');

const current = taskById(state, state.current_task_id);
assert.equal(current.status, 'BLOCKED');
assert.equal(current.block_reason.code, 'GOVERNANCE_HANDOFF_RECONCILIATION_REQUIRED');
assert.equal(
  state.review_history[0].pull_request.head_sha,
  '025d9db1dd2a01c08d8f554716acca305e40b001',
);
assert.equal(state.review_history[0].review_evidence.outcome, 'REQUEST_CHANGES');

const selected = selectReady(fixture);
const claimInput = {
  task_id: selected.task_id,
  dispatch_run_id: 'dispatch-synthetic-001',
  worker_thread_id: 'synthetic-thread-luna-high',
};
const claimed = claim(fixture, 10, claimInput);
assert.equal(claimed.state_revision, 11);
assert.throws(() => claim(claimed, 10, claimInput), /DISPATCH_STALE_STATE_REVISION/);
assert.throws(() => claim(claimed, 11, claimInput), /DISPATCH_ALREADY_CLAIMED/);

const pr = {
  owner: 'Li-Ming-G',
  repo: 'elder_interview_ai',
  number: 75,
  url: 'https://github.com/Li-Ming-G/elder_interview_ai/pull/75',
  head_sha: '1111111111111111111111111111111111111111',
};
const tests = [
  {
    kind: 'command',
    name: 'synthetic deterministic gate',
    status: 'PASS',
    url_or_id: 'command:node dispatcher-dry-run.mjs',
    head_sha: pr.head_sha,
  },
];
const completion = {
  ...claimInput,
  pull_request: pr,
  test_evidence: tests,
};

assert.throws(
  () =>
    completeWorker(claimed, 11, {
      ...completion,
      pull_request: { ...pr, url: 'https://example.invalid/pull/75' },
    }),
  /DISPATCH_PR_REPOSITORY_MISMATCH/,
);
assert.throws(
  () => completeWorker(claimed, 11, { ...completion, test_evidence: [] }),
  /DISPATCH_TEST_EVIDENCE_MISSING/,
);

const inReview = completeWorker(claimed, 11, completion);
assert.equal(inReview.state_revision, 12);
assert.equal(reviewStop(inReview, selected.task_id), 'DISPATCH_REVIEW_GATE_STOP');
assert.throws(() => completeWorker(inReview, 11, completion), /DISPATCH_STALE_STATE_REVISION/);
assert.throws(
  () =>
    completeWorker(claimed, 11, {
      ...completion,
      worker_thread_id: 'late-or-wrong-worker-thread',
    }),
  /DISPATCH_LATE_WORKER_COMPLETION/,
);

const passReview = {
  reviewer_identity: 'synthetic-independent-reviewer',
  review_url_or_id: 'codex-thread:00000000-0000-0000-0000-000000000000:synthetic-review',
  outcome: 'PASS',
  reviewed_head_sha: pr.head_sha,
  findings: { p0: 0, p1: 0, p2: 0 },
};
assert.throws(
  () => applyReview(inReview, 12, selected.task_id, 'PASS'),
  /DISPATCH_REVIEW_EVIDENCE_MISSING/,
);
assert.throws(
  () =>
    applyReview(inReview, 12, selected.task_id, {
      ...passReview,
      reviewed_head_sha: '2222222222222222222222222222222222222222',
    }),
  /DISPATCH_REVIEW_HEAD_STALE/,
);
assert.throws(
  () =>
    applyReview(inReview, 12, selected.task_id, {
      ...passReview,
      review_url_or_id: 'https://example.invalid/review/75',
    }),
  /DISPATCH_REVIEW_EVIDENCE_INVALID/,
);

const withoutTests = clone(inReview);
taskById(withoutTests, selected.task_id).test_evidence = [];
assert.throws(
  () => applyReview(withoutTests, 12, selected.task_id, passReview),
  /DISPATCH_TEST_EVIDENCE_MISSING/,
);
const bypass = clone(inReview);
taskById(bypass, selected.task_id).review_required = false;
assert.throws(() => validateState(bypass), /DISPATCH_REVIEW_REQUIRED/);

const passed = applyReview(inReview, 12, selected.task_id, passReview);
assert.equal(passed.state_revision, 13);
assert.equal(taskById(passed, 'SYNTHETIC-READY-001').status, 'DONE');
assert.equal(taskById(passed, 'SYNTHETIC-NEXT-001').status, 'READY');
assert.equal(passed.review_history.length, 1);
assert.throws(
  () => applyReview(passed, 12, selected.task_id, passReview),
  /DISPATCH_STALE_STATE_REVISION/,
);

const requestChanges = { ...passReview, outcome: 'REQUEST_CHANGES' };
const rework = applyReview(inReview, 12, selected.task_id, requestChanges, {
  dispatch_run_id: 'dispatch-synthetic-rework-001',
  worker_thread_id: 'synthetic-thread-luna-high-rework',
});
assert.equal(rework.state_revision, 13);
assert.equal(taskById(rework, selected.task_id).status, 'IN_PROGRESS');
assert.equal(taskById(rework, selected.task_id).task_card, selected.task_card);
assert.throws(
  () => applyReview(rework, 12, selected.task_id, requestChanges, {}),
  /DISPATCH_STALE_STATE_REVISION/,
);

const ambiguityReview = { ...passReview, outcome: 'PRODUCT_AMBIGUITY' };
const ambiguityBlocked = applyReview(inReview, 12, selected.task_id, ambiguityReview);
assert.equal(taskById(ambiguityBlocked, selected.task_id).status, 'BLOCKED');
assert.equal(
  taskById(ambiguityBlocked, selected.task_id).block_reason.code,
  'DISPATCH_PRODUCT_AMBIGUITY',
);
const authorityBlocked = blockTask(fixture, 10, selected.task_id, 'DISPATCH_AUTHORITY_CONFLICT');
assert.equal(taskById(authorityBlocked, selected.task_id).status, 'BLOCKED');
assert.equal(
  taskById(authorityBlocked, selected.task_id).block_reason.code,
  'DISPATCH_AUTHORITY_CONFLICT',
);

const multipleReady = clone(fixture);
taskById(multipleReady, 'SYNTHETIC-NEXT-001').status = 'READY';
taskById(multipleReady, 'SYNTHETIC-NEXT-001').block_reason = null;
assert.throws(() => selectReady(multipleReady), /DISPATCH_MULTIPLE_READY_TASKS/);

const output = {
  result: 'PASS',
  current_state: {
    task_id: current.task_id,
    status: current.status,
    action: 'STOP',
    code: current.block_reason.code,
  },
  synthetic: {
    fixture_uses_dispatcher_state_v2_schema: true,
    worker_profile: selected.worker_profile,
    single_ready_snapshot_single_claim: true,
    every_write_requires_expected_revision: true,
    every_successful_write_increments_once: true,
    late_worker_completion_rejected: true,
    repository_pr_number_head_and_tests_bound: true,
    fake_pr_bare_pass_stale_review_and_missing_tests_rejected: true,
    review_required_cannot_be_bypassed: true,
    review_stop: true,
    pass_atomically_completes_and_unlocks_predefined_next: true,
    request_changes_reworks_same_task: true,
    blocked_ambiguity_and_authority_conflict_stop: true,
  },
  native_verification: {
    thread_id: profile.verification.thread_id,
    result: profile.verification.result.work_result,
    evidence_class: profile.verification.evidence_class,
    warning:
      'Synthetic launch capability is not implementation, test, PR, or external review evidence.',
  },
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
