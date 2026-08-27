import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const taskFields = ['id', 'status', 'task_card', 'worker_profile', 'depends_on', 'pr', 'next_task'];
const verdictMarker = '<!-- ARCHITECT_VERDICT_V1 -->';
const stableErrors = new Set([
  'NO_READY_TASK',
  'WORKER_FAILED',
  'REVIEW_REQUIRED',
  'PRODUCT_AMBIGUITY',
  'TASK_BLOCKED',
]);

async function load(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), 'utf8'));
}

function taskMap(canonicalQueue) {
  return new Map(canonicalQueue.map((task) => [task.id, task]));
}

function assertCanonicalTopology(canonicalQueue) {
  assert(canonicalQueue.length > 0);
  const ids = new Set();
  for (const task of canonicalQueue) {
    assert.match(task.id, /^[A-Z][A-Z0-9-]{2,119}$/);
    assert(!ids.has(task.id), `duplicate canonical task ${task.id}`);
    ids.add(task.id);
    assert(task.task_card.startsWith('docs/agent/'));
    assert(Array.isArray(task.depends_on));
    for (const dependency of task.depends_on)
      assert(canonicalQueue.some((candidate) => candidate.id === dependency));
    assert(
      task.next_task === null ||
        canonicalQueue.some((candidate) => candidate.id === task.next_task),
    );
  }
  return ids;
}

function validateStateShape(state) {
  assert.deepEqual(Object.keys(state).sort(), ['$schema', 'queue'].sort());
  assert(Array.isArray(state.queue) && state.queue.length > 0);
  for (const task of state.queue)
    assert.deepEqual(Object.keys(task).sort(), [...taskFields].sort());
}

function textOf(pr) {
  return `${pr.title || ''}\n${pr.body || ''}`.toLowerCase();
}

function slug(id) {
  return id.toLowerCase().replaceAll('_', '-');
}

function scorePr(task, pr) {
  if (pr.base?.ref !== 'main' || pr.draft) return null;
  const text = textOf(pr);
  const branch = (pr.head?.ref || '').toLowerCase();
  const exact = task.id.toLowerCase();
  let score = 0;
  const evidence = [];
  if (text.includes(exact)) {
    score += 100;
    evidence.push('exact-task-id');
  }
  if (text.includes(task.task_card.toLowerCase())) {
    score += 30;
    evidence.push('task-card');
  }
  if (branch.includes(slug(task.id))) {
    score += 20;
    evidence.push('task-branch');
  }
  for (const related of [...task.depends_on, task.next_task].filter(Boolean)) {
    if (text.includes(related.toLowerCase()) || branch.includes(slug(related))) {
      score += 10;
      evidence.push(`topology:${related}`);
    }
  }
  if (task.phase && text.includes(task.phase.toLowerCase())) {
    score += 5;
    evidence.push('phase');
  }
  return score > 0 ? { pr, score, evidence } : null;
}

function discoverCandidates(task, github) {
  return (github.prs || [])
    .filter((pr) => pr.merged || pr.state !== 'closed')
    .map((pr) => scorePr(task, pr))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.pr.number - b.pr.number);
}

function discoverUnique(task, github) {
  const candidates = discoverCandidates(task, github);
  if (candidates.length === 0) return { kind: 'none', candidates: [] };
  const bestScore = candidates[0].score;
  const best = candidates.filter((candidate) => candidate.score === bestScore);
  if (best.length > 1) return { kind: 'ambiguous', candidates: best };
  return { kind: 'unique', candidate: best[0], candidates };
}

function parseVerdict(comment, taskId, prNumber) {
  if (!comment.topLevel || !comment.body?.includes(verdictMarker)) return { kind: 'ignore' };
  const fields = {};
  for (const line of comment.body.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+):\s*(.+?)\s*$/);
    if (match) fields[match[1]] = match[2];
  }
  const required = ['TASK', 'PR', 'REVIEWED_HEAD', 'VERDICT', 'P0', 'P1', 'P2'];
  if (required.some((field) => !(field in fields))) return { kind: 'malformed' };
  if (fields.TASK !== taskId || Number(fields.PR) !== prNumber) return { kind: 'other-task' };
  if (!/^[0-9a-f]{40}$/i.test(fields.REVIEWED_HEAD)) return { kind: 'malformed' };
  if (!['PASS', 'REQUEST_CHANGES', 'PRODUCT_AMBIGUITY'].includes(fields.VERDICT))
    return { kind: 'malformed' };
  if (![fields.P0, fields.P1, fields.P2].every((value) => /^\d+$/.test(value)))
    return { kind: 'malformed' };
  return { kind: 'valid', ...fields, createdAt: comment.createdAt || '' };
}

function currentVerdict(task, pr) {
  const parsed = (pr.comments || []).map((comment) => parseVerdict(comment, task.id, pr.number));
  if (parsed.some((item) => item.kind === 'malformed'))
    return { kind: 'ambiguous', reason: 'PRODUCT_AMBIGUITY' };
  const valid = parsed.filter(
    (item) =>
      item.kind === 'valid' && item.REVIEWED_HEAD.toLowerCase() === pr.head.sha.toLowerCase(),
  );
  if (valid.length === 0) return { kind: 'none' };
  const verdicts = new Set(valid.map((item) => item.VERDICT));
  if (verdicts.size > 1) return { kind: 'ambiguous', reason: 'PRODUCT_AMBIGUITY' };
  valid.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { kind: 'valid', verdict: valid.at(-1).VERDICT };
}

function latestApplicableMainCi(main) {
  if (!main?.sha) return null;
  const exactMainAttempts = (main.requiredCiAttempts || [])
    .filter((attempt) => attempt.headSha?.toLowerCase() === main.sha.toLowerCase())
    .sort(
      (a, b) =>
        (b.runAttempt || 0) - (a.runAttempt || 0) ||
        (b.updatedAt || '').localeCompare(a.updatedAt || '') ||
        (b.runId || 0) - (a.runId || 0),
    );
  return exactMainAttempts[0] || null;
}

function verifyMergedMain(pr, github) {
  const main = github.main;
  if (!main?.sha || !pr.mergeCommitSha) return { kind: 'wait', detail: 'MAIN_CI_PENDING' };
  const acceptedMergeInAncestry = (main.ancestry || []).some(
    (sha) => sha.toLowerCase() === pr.mergeCommitSha.toLowerCase(),
  );
  if (!acceptedMergeInAncestry) return { kind: 'blocked', detail: 'MAIN_ANCESTRY_UNPROVEN' };
  const latestAttempt = latestApplicableMainCi(main);
  if (!latestAttempt || latestAttempt.status !== 'completed')
    return { kind: 'wait', detail: 'MAIN_CI_PENDING' };
  if (latestAttempt.conclusion === 'success') return { kind: 'success', latestAttempt };
  return { kind: 'blocked', detail: 'MAIN_VERIFY_FAILED', latestAttempt };
}

function projectStatus(task, pr, github) {
  if (!pr) return { status: 'IN_PROGRESS', pr: null, action: 'WAIT' };
  const verdict = currentVerdict(task, pr);
  if (verdict.kind === 'ambiguous')
    return { status: 'BLOCKED', pr: pr.number, error: 'PRODUCT_AMBIGUITY' };
  if (pr.merged) {
    if (verdict.kind !== 'valid' || verdict.verdict !== 'PASS')
      return { status: 'REVIEW', pr: pr.number, action: 'WAIT_FOR_VERDICT' };
    const mainVerification = verifyMergedMain(pr, github);
    if (mainVerification.kind === 'wait')
      return {
        status: 'REVIEW',
        pr: pr.number,
        action: 'WAIT_MAIN_CI',
        detail: mainVerification.detail,
      };
    if (mainVerification.kind === 'blocked')
      return {
        status: 'BLOCKED',
        pr: pr.number,
        error: 'TASK_BLOCKED',
        detail: mainVerification.detail,
      };
    return {
      status: 'DONE',
      pr: pr.number,
      action: task.next_task ? 'READY_PREDEFINED_NEXT' : 'DONE',
      nextTask: task.next_task,
    };
  }
  if (verdict.kind === 'valid' && verdict.verdict === 'PRODUCT_AMBIGUITY')
    return { status: 'BLOCKED', pr: pr.number, error: 'PRODUCT_AMBIGUITY' };
  if (verdict.kind === 'valid' && verdict.verdict === 'REQUEST_CHANGES')
    return { status: 'IN_PROGRESS', pr: pr.number, action: 'REPAIR_SAME_PR' };
  if (verdict.kind === 'valid' && verdict.verdict === 'PASS') {
    if (!github.freshRead || github.freshHeadSha?.toLowerCase() !== pr.head.sha.toLowerCase())
      return { status: 'REVIEW', pr: pr.number, action: 'FRESH_HEAD_RECHECK_REQUIRED' };
    return { status: 'REVIEW', pr: pr.number, action: 'MERGE_ELIGIBLE_AFTER_FRESH_HEAD_RECHECK' };
  }
  return { status: 'REVIEW', pr: pr.number, action: 'WAIT_FOR_VERDICT' };
}

function reconcile(canonicalQueue, local, github) {
  const ids = assertCanonicalTopology(canonicalQueue);
  const byId = taskMap(canonicalQueue);
  const localId = local.activeTaskId;
  const invalidLocalId = Boolean(localId && !ids.has(localId));
  const candidatesByTask = canonicalQueue.map((task) => ({
    task,
    found: discoverUnique(task, github),
  }));
  const relevantCandidates =
    localId && !invalidLocalId
      ? candidatesByTask.filter(({ task }) => task.id === localId)
      : candidatesByTask;
  const ambiguous = relevantCandidates.find(({ found }) => found.kind === 'ambiguous');
  if (ambiguous)
    return {
      status: 'BLOCKED',
      error: 'PRODUCT_AMBIGUITY',
      detail: 'equal PR candidates',
      candidates: ambiguous.found.candidates.map((item) => item.pr.number),
    };
  let selected =
    localId && byId.has(localId)
      ? {
          task: byId.get(localId),
          found: candidatesByTask.find(({ task }) => task.id === localId).found,
        }
      : null;
  if (invalidLocalId) {
    const unique = candidatesByTask
      .filter(({ found }) => found.kind === 'unique')
      .sort((a, b) => b.found.candidate.score - a.found.candidate.score);
    if (
      unique.length === 0 ||
      (unique[1] && unique[0].found.candidate.score === unique[1].found.candidate.score)
    )
      return {
        status: 'BLOCKED',
        error: 'PRODUCT_AMBIGUITY',
        detail: 'invented task ID has no unique canonical recovery',
      };
    selected = unique[0];
  }
  if (!selected) return { status: 'NO_READY_TASK', error: 'NO_READY_TASK' };
  const task = selected.task;
  const localTask = local.tasks?.[task.id] || { pr: null };
  const pr =
    (github.prs || []).find((candidate) => candidate.number === localTask.pr) ||
    selected.found.candidate?.pr ||
    null;
  const result = projectStatus(task, pr, github);
  return {
    canonicalTaskId: task.id,
    recoveredFrom: invalidLocalId ? localId : undefined,
    ...result,
  };
}

function validateSmokeFixture() {
  const state = {
    $schema: './dispatcher-state.schema.json',
    queue: [
      {
        id: 'SYNTHETIC-A',
        status: 'READY',
        task_card: 'docs/agent/tasks/SYNTHETIC-A.md',
        worker_profile: 'luna-high',
        depends_on: [],
        pr: null,
        next_task: 'SYNTHETIC-B',
      },
      {
        id: 'SYNTHETIC-B',
        status: 'DEFERRED',
        task_card: 'docs/agent/tasks/SYNTHETIC-B.md',
        worker_profile: 'luna-high',
        depends_on: ['SYNTHETIC-A'],
        pr: null,
        next_task: null,
      },
    ],
  };
  validateStateShape(state);
  state.queue[0].status = 'IN_PROGRESS';
  state.queue[0].pr = 75;
  state.queue[0].status = 'REVIEW';
  state.queue[0].status = 'DONE';
  state.queue[1].status = 'READY';
  assert.equal(state.queue[0].status, 'DONE');
  assert.equal(state.queue[1].status, 'READY');
}

const fixture = await load('fixtures/reconciliation-cases.json');
validateSmokeFixture();
const canonical = fixture.canonicalQueue;
const results = {};

results.A = reconcile(
  canonical,
  fixture.cases.A_stale_local_status.local,
  fixture.cases.A_stale_local_status.github,
);
assert.equal(results.A.canonicalTaskId, 'P4C-01');
assert.equal(results.A.status, 'DONE');

results.B = reconcile(
  canonical,
  fixture.cases.B_invented_task_id.local,
  fixture.cases.B_invented_task_id.github,
);
assert.equal(results.B.canonicalTaskId, 'P4C-02');
assert.notEqual(results.B.canonicalTaskId, 'P4C-02-ASSEMBLY');
assert.equal(results.B.status, 'DONE');

results.C = reconcile(canonical, fixture.cases.C_null_pr.local, fixture.cases.C_null_pr.github);
assert.equal(results.C.pr, 89);
assert.equal(results.C.canonicalTaskId, 'P4C-02');

results.D = reconcile(
  canonical,
  fixture.cases.D_old_head_verdict.local,
  fixture.cases.D_old_head_verdict.github,
);
assert.equal(results.D.status, 'REVIEW');
assert.equal(results.D.action, 'WAIT_FOR_VERDICT');

results.E = reconcile(
  canonical,
  fixture.cases.E_current_head_request_changes.local,
  fixture.cases.E_current_head_request_changes.github,
);
assert.equal(results.E.status, 'IN_PROGRESS');
assert.equal(results.E.action, 'REPAIR_SAME_PR');
assert.equal(results.E.pr, 190);

results.F = reconcile(
  canonical,
  fixture.cases.F_current_head_pass.local,
  fixture.cases.F_current_head_pass.github,
);
assert.equal(results.F.action, 'MERGE_ELIGIBLE_AFTER_FRESH_HEAD_RECHECK');
const noFreshPass = reconcile(canonical, fixture.cases.F_current_head_pass.local, {
  ...fixture.cases.F_current_head_pass.github,
  freshRead: false,
});
assert.equal(noFreshPass.action, 'FRESH_HEAD_RECHECK_REQUIRED');

results.G = reconcile(
  canonical,
  fixture.cases.G_ambiguous_pr.local,
  fixture.cases.G_ambiguous_pr.github,
);
assert.equal(results.G.status, 'BLOCKED');
assert.equal(results.G.error, 'PRODUCT_AMBIGUITY');

results.H = reconcile(
  canonical,
  fixture.cases.H_ci_pending.local,
  fixture.cases.H_ci_pending.github,
);
assert.equal(results.H.status, 'REVIEW');
assert.equal(results.H.action, 'WAIT_MAIN_CI');
assert.equal(results.H.detail, 'MAIN_CI_PENDING');
assert.equal(results.H.error, undefined);
assert.notEqual(results.H.action, 'READY_PREDEFINED_NEXT');

const mainFailure = reconcile(canonical, fixture.cases.H_ci_pending.local, {
  ...fixture.cases.H_ci_pending.github,
  main: {
    ...fixture.cases.H_ci_pending.github.main,
    requiredCiAttempts: [
      {
        headSha: fixture.cases.H_ci_pending.github.main.sha,
        runId: 8001,
        runAttempt: 1,
        status: 'completed',
        conclusion: 'failure',
      },
    ],
  },
});
assert.equal(mainFailure.status, 'BLOCKED');
assert.equal(mainFailure.error, 'TASK_BLOCKED');
assert.equal(mainFailure.detail, 'MAIN_VERIFY_FAILED');

results.I = reconcile(
  canonical,
  fixture.cases.I_merged_successful_main.local,
  fixture.cases.I_merged_successful_main.github,
);
assert.equal(results.I.status, 'DONE');
assert.equal(results.I.nextTask, 'DISPATCHER-RECOVERY-001');
assert.equal(results.I.action, 'READY_PREDEFINED_NEXT');
assert.notEqual(results.I.canonicalTaskId, 'P4C-03');

results.J = reconcile(
  canonical,
  fixture.cases.J_initial_main_failure.local,
  fixture.cases.J_initial_main_failure.github,
);
assert.equal(results.J.status, 'BLOCKED');
assert.equal(results.J.error, 'TASK_BLOCKED');
assert.equal(results.J.detail, 'MAIN_VERIFY_FAILED');

results.K = reconcile(
  canonical,
  fixture.cases.K_same_main_rerun_recovery.local,
  fixture.cases.K_same_main_rerun_recovery.github,
);
assert.equal(results.K.status, 'DONE');
assert.equal(results.K.action, 'READY_PREDEFINED_NEXT');
assert.equal(results.K.nextTask, 'DISPATCHER-RECOVERY-001');

const nullSuccessor = reconcile(
  canonical,
  fixture.cases.K_null_successor_recovery.local,
  fixture.cases.K_null_successor_recovery.github,
);
assert.equal(nullSuccessor.status, 'DONE');
assert.equal(nullSuccessor.action, 'DONE');
assert.equal(nullSuccessor.nextTask, null);

results.L = reconcile(
  canonical,
  fixture.cases.L_descendant_main_recovery.local,
  fixture.cases.L_descendant_main_recovery.github,
);
assert.equal(results.L.status, 'DONE');

results.M = reconcile(
  canonical,
  fixture.cases.M_false_recovery_prohibited.local,
  fixture.cases.M_false_recovery_prohibited.github,
);
assert.notEqual(results.M.status, 'DONE');
assert.equal(results.M.status, 'BLOCKED');
assert.equal(results.M.error, 'TASK_BLOCKED');
assert.equal(results.M.detail, 'MAIN_ANCESTRY_UNPROVEN');

for (const result of Object.values(results)) {
  if (result.error) assert(stableErrors.has(result.error));
}

process.stdout.write(`${JSON.stringify({ result: 'PASS', cases: results }, null, 2)}\n`);
