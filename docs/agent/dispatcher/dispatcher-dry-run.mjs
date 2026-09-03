import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const taskFields = ['id', 'status', 'task_card', 'worker_profile', 'depends_on', 'pr', 'next_task'];
const verdictMarker = '<!-- ARCHITECT_VERDICT_V1 -->';
const repairMarker = '<!-- DISPATCHER_REPAIR_V1 -->';
const directiveMarker = '<!-- ARCHITECT_DIRECTIVE_V1 -->';
const directiveAckMarker = '<!-- DISPATCHER_DIRECTIVE_ACK_V1 -->';
const reviewContextMarker = '<!-- ARCHITECT_REVIEW_CONTEXT_V1 -->';
const directiveFields = [
  'DIRECTIVE_ID',
  'TASK',
  'PR',
  'HEAD',
  'DECISION_CLASS',
  'ACTION',
  'ADD_ALLOWED_FILES',
  'ADD_REQUIRED_TESTS',
  'INSTRUCTION',
  'KEEP_SAME_PR',
];
const ackFields = [
  'DIRECTIVE_ID',
  'DIRECTIVE_SHA256',
  'TASK',
  'PR',
  'HEAD',
  'ACTION',
  'WORKER_REF',
  'EFFECTIVE_ALLOWED_FILES',
  'EFFECTIVE_REQUIRED_TESTS',
  'RESULT',
];
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
      assert(typeof dependency === 'string' && dependency.length > 0);
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
  for (const task of state.queue) {
    assert.deepEqual(Object.keys(task).sort(), [...taskFields].sort());
    if (['READY', 'DEFERRED'].includes(task.status)) assert.equal(task.pr, null);
    if (['REVIEW', 'DONE'].includes(task.status)) assert(Number.isInteger(task.pr) && task.pr > 0);
    if (['IN_PROGRESS', 'BLOCKED'].includes(task.status))
      assert(task.pr === null || (Number.isInteger(task.pr) && task.pr > 0));
  }
}

function textOf(pr) {
  return `${pr.title || ''}\n${pr.body || ''}`.toLowerCase();
}

function parseMachineFields(body, marker) {
  if (typeof body !== 'string' || !body.includes(marker)) return null;
  const fields = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === marker) continue;
    const match = line.match(/^([A-Z0-9_]+):\s*(.*?)\s*$/);
    if (!match || match[1] in fields) return { invalid: true };
    fields[match[1]] = match[2];
  }
  return fields;
}

function listValue(value) {
  if (value === 'none') return [];
  return [
    ...new Set(
      String(value)
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeList(value) {
  const values = listValue(value);
  return values.length === 0 ? 'none' : values.join(';');
}

function normalizeDirective(fields) {
  const normalized = { ...fields };
  normalized.ADD_ALLOWED_FILES = normalizeList(fields.ADD_ALLOWED_FILES);
  normalized.ADD_REQUIRED_TESTS = normalizeList(fields.ADD_REQUIRED_TESTS);
  return directiveFields.map((field) => `${field}: ${normalized[field].trim()}`).join('\n');
}

function directiveDigest(fields) {
  return createHash('sha256').update(normalizeDirective(fields), 'utf8').digest('hex');
}

function authorizedMarkerAuthor(comment, controlPlane, allowlistField) {
  if (!controlPlane?.enabled) return true;
  return (controlPlane[allowlistField] || []).includes(comment.author?.login);
}

function malformedDirectiveIdentity(comment) {
  if (!comment.id) return null;
  const stableCommentId = String(comment.id);
  const normalizedBody = String(comment.body || '').replace(/\r\n/g, '\n');
  const digest = createHash('sha256')
    .update(`COMMENT_ID: ${stableCommentId}\n${normalizedBody}`, 'utf8')
    .digest('hex');
  return { id: `malformed:${digest}`, digest };
}

function protectedDirectivePath(path, task) {
  const protectedExact = new Set([
    'AGENTS.md',
    'AI-DEVELOPMENT-CURRENT.md',
    'docs/agent/00-task-board.md',
    task.task_card,
    ...(task.accepted_contracts || []),
  ]);
  return (
    protectedExact.has(path) ||
    path.startsWith('docs/agent/dispatcher/') ||
    path.includes('..') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    ['*', '?', '[', ']'].some((token) => path.includes(token))
  );
}

function parseDirective(comment, controlPlane) {
  if (!comment.topLevel || !comment.body?.includes(directiveMarker)) return { kind: 'ignore' };
  if (!authorizedMarkerAuthor(comment, controlPlane, 'authorized_architect_logins'))
    return { kind: 'ignore' };
  const fields = parseMachineFields(comment.body, directiveMarker);
  if (!fields || fields.invalid) return { kind: 'invalid', reason: 'MALFORMED_FIELDS' };
  if (
    Object.keys(fields).length !== directiveFields.length ||
    directiveFields.some((field) => !(field in fields)) ||
    Object.keys(fields).some((field) => !directiveFields.includes(field))
  )
    return { kind: 'invalid', reason: 'FIELD_SET' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(fields.DIRECTIVE_ID))
    return { kind: 'invalid', reason: 'DIRECTIVE_ID', fields };
  if (!/^[A-Z][A-Z0-9-]{2,119}$/.test(fields.TASK))
    return { kind: 'invalid', reason: 'TASK', fields };
  const prNull = fields.PR === 'null';
  const headNull = fields.HEAD === 'null';
  if (prNull !== headNull)
    return { kind: 'invalid', reason: 'PR_HEAD_PAIR', fields, digest: directiveDigest(fields) };
  if (!prNull && (!/^\d+$/.test(fields.PR) || !/^[0-9a-f]{40}$/i.test(fields.HEAD)))
    return { kind: 'invalid', reason: 'PR_HEAD_FORMAT', fields };
  if (
    fields.DECISION_CLASS !== 'IMPLEMENTATION_ONLY' ||
    fields.ACTION !== 'IMPLEMENT' ||
    !['true', 'false'].includes(fields.KEEP_SAME_PR) ||
    (!prNull && fields.KEEP_SAME_PR !== 'true') ||
    !fields.INSTRUCTION ||
    /[\r\n]/.test(fields.INSTRUCTION)
  )
    return { kind: 'invalid', reason: 'FIXED_VALUES', fields };
  return {
    kind: 'valid',
    fields,
    digest: directiveDigest(fields),
    createdAt: comment.createdAt || '',
  };
}

function parseDirectiveAck(comment, controlPlane) {
  if (!comment.topLevel || !comment.body?.includes(directiveAckMarker)) return { kind: 'ignore' };
  const fields = parseMachineFields(comment.body, directiveAckMarker);
  if (!fields || fields.invalid) return { kind: 'invalid' };
  const action = fields?.ACTION;
  const launchFailureAttempt = fields?.RESULT?.match(/^WORKER_LAUNCH_FAILED_ATTEMPT_([1-3])$/);
  if (
    Object.keys(fields).length !== ackFields.length ||
    ackFields.some((field) => !(field in fields)) ||
    Object.keys(fields).some((field) => !ackFields.includes(field)) ||
    !controlPlane.authorized_dispatcher_logins.includes(comment.author?.login) ||
    !/^[0-9a-f]{64}$/.test(fields.DIRECTIVE_SHA256) ||
    !['LAUNCHED', 'APPLIED', 'LAUNCH_FAILED', 'REJECTED_STALE', 'REJECTED_INVALID'].includes(
      action,
    ) ||
    (['LAUNCHED', 'APPLIED'].includes(action) &&
      (!fields.WORKER_REF || fields.WORKER_REF === 'none')) ||
    (action === 'LAUNCH_FAILED' && (fields.WORKER_REF !== 'none' || !launchFailureAttempt)) ||
    (['REJECTED_STALE', 'REJECTED_INVALID'].includes(action) && fields.WORKER_REF !== 'none')
  )
    return { kind: 'invalid' };
  return { kind: 'valid', fields, createdAt: comment.createdAt || '' };
}

function successfulDirectiveAcks(comments, taskId, controlPlane) {
  return (comments || [])
    .map((comment) => parseDirectiveAck(comment, controlPlane))
    .filter(
      (ack) =>
        ack.kind === 'valid' &&
        ack.fields.TASK === taskId &&
        ['LAUNCHED', 'APPLIED'].includes(ack.fields.ACTION),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function effectiveEnvelope(task, acks, pendingDirective = null) {
  const allowedFiles = [...(task.allowed_files || [])];
  const requiredTests = [...(task.required_tests || [])];
  for (const ack of acks) {
    allowedFiles.push(...listValue(ack.fields.EFFECTIVE_ALLOWED_FILES));
    requiredTests.push(...listValue(ack.fields.EFFECTIVE_REQUIRED_TESTS));
  }
  if (pendingDirective) {
    allowedFiles.push(...listValue(pendingDirective.fields.ADD_ALLOWED_FILES));
    requiredTests.push(...listValue(pendingDirective.fields.ADD_REQUIRED_TESTS));
  }
  return {
    allowedFiles: [...new Set(allowedFiles)],
    requiredTests: [...new Set(requiredTests)],
  };
}

function directiveAckBody(directive, task, pr, head, action, workerRef, envelope, result) {
  return `${directiveAckMarker}\nDIRECTIVE_ID: ${directive.fields.DIRECTIVE_ID}\nDIRECTIVE_SHA256: ${directive.digest}\nTASK: ${task.id}\nPR: ${pr ?? 'null'}\nHEAD: ${head ?? 'null'}\nACTION: ${action}\nWORKER_REF: ${workerRef}\nEFFECTIVE_ALLOWED_FILES: ${envelope.allowedFiles.join(';') || 'none'}\nEFFECTIVE_REQUIRED_TESTS: ${envelope.requiredTests.join(';') || 'none'}\nRESULT: ${result}`;
}

function rejectionAckBody(identity, task, directive, action, result) {
  const fields = directive.fields || {};
  return `${directiveAckMarker}\nDIRECTIVE_ID: ${identity.id}\nDIRECTIVE_SHA256: ${identity.digest}\nTASK: ${task.id}\nPR: ${fields.PR ?? 'null'}\nHEAD: ${fields.HEAD ?? 'null'}\nACTION: ${action}\nWORKER_REF: none\nEFFECTIVE_ALLOWED_FILES: none\nEFFECTIVE_REQUIRED_TESTS: none\nRESULT: ${result}`;
}

function directiveIdentity(comment, directive) {
  return directive.kind === 'valid'
    ? { id: directive.fields.DIRECTIVE_ID, digest: directive.digest }
    : malformedDirectiveIdentity(comment);
}

function matchingDirectiveOutcome(allAcks, identity, actions) {
  return allAcks.some(
    (ack) =>
      ack.fields.DIRECTIVE_ID === identity.id &&
      ack.fields.DIRECTIVE_SHA256 === identity.digest &&
      actions.includes(ack.fields.ACTION),
  );
}

function directiveLaunchFailureSequence(allAcks, identity) {
  const failures = allAcks
    .filter(
      (ack) =>
        ack.fields.DIRECTIVE_ID === identity.id &&
        ack.fields.DIRECTIVE_SHA256 === identity.digest &&
        ack.fields.ACTION === 'LAUNCH_FAILED',
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const attempts = failures.map((ack) =>
    Number(ack.fields.RESULT.match(/^WORKER_LAUNCH_FAILED_ATTEMPT_([1-3])$/)?.[1]),
  );
  return {
    kind: attempts.every((attempt, index) => attempt === index + 1) ? 'valid' : 'invalid',
    count: attempts.length,
  };
}

function reconcileDirective(canonicalQueue, local, github, controlPlane) {
  if (!github.commandBus || !controlPlane?.enabled) return null;
  const active = canonicalQueue.filter((task) =>
    ['READY', 'IN_PROGRESS', 'REVIEW', 'BLOCKED'].includes(local.tasks?.[task.id]?.status),
  );
  const task =
    active.find((candidate) => candidate.id === local.activeTaskId) ||
    (active.length === 1 ? active[0] : null);
  const comments = github.commandBus.comments || [];
  const parsed = comments
    .map((comment) => ({ comment, directive: parseDirective(comment, controlPlane) }))
    .filter(({ directive }) => directive.kind !== 'ignore')
    .sort(
      (a, b) =>
        (a.comment.createdAt || '').localeCompare(b.comment.createdAt || '') ||
        String(a.comment.id || '').localeCompare(String(b.comment.id || '')),
    );
  if (parsed.length === 0) return null;
  if (!task)
    return {
      status: 'BLOCKED',
      action: 'REJECTED_INVALID',
      directiveLaunch: false,
      error: 'PRODUCT_AMBIGUITY',
      detail: 'NO_SINGLE_CURRENT_TASK',
    };
  const runtime = local.tasks[task.id];
  const acks = successfulDirectiveAcks(comments, task.id, controlPlane);
  const allAcks = comments
    .map((comment) => parseDirectiveAck(comment, controlPlane))
    .filter((ack) => ack.kind === 'valid');
  const found = discoverUnique(task, github);
  const boundPr = (github.prs || []).find((pr) => pr.number === runtime.pr) || found.candidate?.pr;

  for (const { comment, directive } of parsed) {
    const identity = directiveIdentity(comment, directive);
    if (!identity)
      return {
        canonicalTaskId: task.id,
        status: runtime.status,
        action: 'WAIT_COMMAND_BUS_REFRESH',
        directiveLaunch: false,
        detail: 'MISSING_IMMUTABLE_COMMENT_ID',
      };
    if (matchingDirectiveOutcome(allAcks, identity, ['REJECTED_INVALID', 'REJECTED_STALE']))
      continue;
    if (directive.kind === 'invalid')
      return {
        canonicalTaskId: task.id,
        status: runtime.status,
        action: 'REJECTED_INVALID',
        directiveLaunch: false,
        detail: directive.reason,
        rejectionIdentity: identity.id,
        ack: rejectionAckBody(identity, task, directive, 'REJECTED_INVALID', directive.reason),
      };
    const id = directive.fields.DIRECTIVE_ID;
    const conflictingPayload = parsed.some(
      ({ directive: other }) =>
        other.kind === 'valid' &&
        other.fields.DIRECTIVE_ID === id &&
        other.digest !== directive.digest,
    );
    const conflictingAck = allAcks.some(
      (ack) => ack.fields.DIRECTIVE_ID === id && ack.fields.DIRECTIVE_SHA256 !== directive.digest,
    );
    if (conflictingPayload || conflictingAck)
      return {
        canonicalTaskId: task.id,
        status: 'BLOCKED',
        action: 'REJECTED_INVALID',
        directiveLaunch: false,
        error: 'PRODUCT_AMBIGUITY',
        detail: 'DIRECTIVE_ID_PAYLOAD_CONFLICT',
      };
    if (
      acks.some(
        (ack) => ack.fields.DIRECTIVE_ID === id && ack.fields.DIRECTIVE_SHA256 === directive.digest,
      )
    )
      continue;
    if (directive.fields.TASK !== task.id)
      return {
        canonicalTaskId: task.id,
        status: runtime.status,
        action: 'REJECTED_INVALID',
        directiveLaunch: false,
        detail: 'TASK_MISMATCH',
        rejectionIdentity: identity.id,
        ack: rejectionAckBody(identity, task, directive, 'REJECTED_INVALID', 'TASK_MISMATCH'),
      };
    const addedFiles = listValue(directive.fields.ADD_ALLOWED_FILES);
    if (addedFiles.some((path) => protectedDirectivePath(path, task)))
      return {
        canonicalTaskId: task.id,
        status: 'BLOCKED',
        action: 'REJECTED_INVALID',
        directiveLaunch: false,
        error: 'PRODUCT_AMBIGUITY',
        detail: 'PROTECTED_PATH',
        rejectionIdentity: identity.id,
        ack: rejectionAckBody(identity, task, directive, 'REJECTED_INVALID', 'PROTECTED_PATH'),
      };
    const concrete = directive.fields.PR !== 'null';
    if (!concrete && boundPr)
      return {
        canonicalTaskId: task.id,
        status: runtime.status,
        action: 'REJECTED_STALE',
        directiveLaunch: false,
        detail: 'PR_NULL_WHEN_PR_EXISTS',
        rejectionIdentity: identity.id,
        ack: rejectionAckBody(
          identity,
          task,
          directive,
          'REJECTED_STALE',
          'PR_NULL_WHEN_PR_EXISTS',
        ),
      };
    if (concrete && (!boundPr || Number(directive.fields.PR) !== boundPr.number))
      return {
        canonicalTaskId: task.id,
        status: runtime.status,
        action: 'REJECTED_STALE',
        directiveLaunch: false,
        detail: 'PR_MISMATCH',
        rejectionIdentity: identity.id,
        ack: rejectionAckBody(identity, task, directive, 'REJECTED_STALE', 'PR_MISMATCH'),
      };
    if (concrete && directive.fields.HEAD.toLowerCase() !== boundPr.head.sha.toLowerCase())
      return {
        canonicalTaskId: task.id,
        status: runtime.status,
        action: 'REJECTED_STALE',
        directiveLaunch: false,
        detail: 'HEAD_MISMATCH',
        rejectionIdentity: identity.id,
        ack: rejectionAckBody(identity, task, directive, 'REJECTED_STALE', 'HEAD_MISMATCH'),
      };
    const envelope = effectiveEnvelope(task, acks, directive);
    const workerIdentity = `architect-directive/${task.id}/${id}`;
    const existingWorker = (github.workers || []).find(
      (worker) => worker.identity === workerIdentity,
    );
    if (existingWorker)
      return {
        canonicalTaskId: task.id,
        previousStatus: runtime.status,
        status: 'IN_PROGRESS',
        pr: boundPr?.number ?? null,
        action: 'EXECUTE_ARCHITECT_DIRECTIVE',
        directiveId: id,
        directiveDigest: directive.digest,
        directiveLaunch: false,
        workerIdentity,
        workerRef: existingWorker.ref,
        effectiveEnvelope: envelope,
        reviewFence: true,
        ack: directiveAckBody(
          directive,
          task,
          boundPr?.number ?? null,
          boundPr?.head.sha ?? null,
          'APPLIED',
          existingWorker.ref,
          envelope,
          'RECOVERED_EXISTING_WORKER',
        ),
      };

    const launchFailures = directiveLaunchFailureSequence(allAcks, identity);
    if (launchFailures.kind === 'invalid')
      return {
        canonicalTaskId: task.id,
        status: 'BLOCKED',
        action: 'REJECTED_INVALID',
        directiveLaunch: false,
        error: 'PRODUCT_AMBIGUITY',
        detail: 'INVALID_LAUNCH_FAILED_SEQUENCE',
      };
    if (launchFailures.count >= 3)
      return {
        canonicalTaskId: task.id,
        status: 'BLOCKED',
        action: 'WORKER_FAILED',
        directiveLaunch: false,
        error: 'WORKER_FAILED',
        detail: 'DIRECTIVE_LAUNCH_ATTEMPTS_EXHAUSTED',
      };

    const attempt = launchFailures.count + 1;
    const nativeLaunch = github.nativeDirectiveLaunch || { completed: true, workerRef: null };
    const workerRef =
      typeof nativeLaunch.workerRef === 'string' &&
      nativeLaunch.workerRef.trim() &&
      nativeLaunch.workerRef !== 'none'
        ? nativeLaunch.workerRef
        : null;
    if (nativeLaunch.completed && !workerRef) {
      const thirdFailure = attempt === 3;
      return {
        canonicalTaskId: task.id,
        previousStatus: runtime.status,
        status: thirdFailure ? 'BLOCKED' : 'IN_PROGRESS',
        pr: boundPr?.number ?? null,
        action: thirdFailure ? 'WORKER_FAILED' : 'LAUNCH_FAILED',
        directiveId: id,
        directiveDigest: directive.digest,
        directiveLaunch: true,
        launchAttempt: attempt,
        workerIdentity,
        workerRef: null,
        effectiveEnvelope: envelope,
        reviewFence: false,
        error: thirdFailure ? 'WORKER_FAILED' : undefined,
        detail: thirdFailure ? 'DIRECTIVE_LAUNCH_ATTEMPTS_EXHAUSTED' : undefined,
        ack: directiveAckBody(
          directive,
          task,
          boundPr?.number ?? null,
          boundPr?.head.sha ?? null,
          'LAUNCH_FAILED',
          'none',
          envelope,
          `WORKER_LAUNCH_FAILED_ATTEMPT_${attempt}`,
        ),
      };
    }
    assert(nativeLaunch.completed, 'fixture launch operation must reach a terminal result');
    return {
      canonicalTaskId: task.id,
      previousStatus: runtime.status,
      status: 'IN_PROGRESS',
      pr: boundPr?.number ?? null,
      action: 'EXECUTE_ARCHITECT_DIRECTIVE',
      directiveId: id,
      directiveDigest: directive.digest,
      directiveLaunch: true,
      launchAttempt: attempt,
      workerIdentity,
      workerRef,
      effectiveEnvelope: envelope,
      reviewFence: true,
      ack: directiveAckBody(
        directive,
        task,
        boundPr?.number ?? null,
        boundPr?.head.sha ?? null,
        'LAUNCHED',
        workerRef,
        envelope,
        'WORKER_LAUNCHED',
      ),
    };
  }
  return null;
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

function parseVerdict(comment, taskId, prNumber, controlPlane) {
  if (!comment.topLevel || !comment.body?.includes(verdictMarker)) return { kind: 'ignore' };
  if (!authorizedMarkerAuthor(comment, controlPlane, 'authorized_architect_logins'))
    return { kind: 'ignore' };
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

function currentReviewContext(task, pr, github, controlPlane) {
  if (!github.directiveMode) return { kind: 'legacy' };
  const acks = successfulDirectiveAcks(github.commandBus?.comments, task.id, controlPlane);
  const envelope = effectiveEnvelope(task, acks);
  const expectedIds = acks.map((ack) => ack.fields.DIRECTIVE_ID).join(';') || 'none';
  const latestAckAt = acks.at(-1)?.createdAt || '';
  const required = [
    'TASK',
    'PR',
    'CURRENT_HEAD',
    'BASE_MAIN_SHA',
    'TASK_CARD',
    'ALLOWED_SCOPE',
    'ACCEPTED_CONTRACTS',
    'REQUIRED_TESTS',
    'APPLIED_DIRECTIVES',
  ];
  const valid = (pr.comments || [])
    .filter(
      (comment) =>
        comment.topLevel &&
        comment.body?.includes(reviewContextMarker) &&
        authorizedMarkerAuthor(comment, controlPlane, 'authorized_dispatcher_logins'),
    )
    .map((comment) => ({
      fields: parseMachineFields(comment.body, reviewContextMarker),
      createdAt: comment.createdAt || '',
    }))
    .filter(
      ({ fields, createdAt }) =>
        fields &&
        !fields.invalid &&
        Object.keys(fields).length === required.length &&
        required.every((field) => field in fields) &&
        fields.TASK === task.id &&
        Number(fields.PR) === pr.number &&
        fields.CURRENT_HEAD.toLowerCase() === pr.head.sha.toLowerCase() &&
        /^[0-9a-f]{40}$/i.test(fields.BASE_MAIN_SHA) &&
        fields.TASK_CARD === task.task_card &&
        normalizeList(fields.ALLOWED_SCOPE) === normalizeList(envelope.allowedFiles.join(';')) &&
        normalizeList(fields.REQUIRED_TESTS) === normalizeList(envelope.requiredTests.join(';')) &&
        fields.APPLIED_DIRECTIVES === expectedIds &&
        createdAt > latestAckAt,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return valid.length === 0 ? { kind: 'none' } : { kind: 'valid', ...valid.at(-1) };
}

function currentVerdict(task, pr, github = {}, controlPlane = null) {
  const context = currentReviewContext(task, pr, github, controlPlane);
  if (github.directiveMode && context.kind !== 'valid') return { kind: 'none' };
  const parsed = (pr.comments || []).map((comment) =>
    parseVerdict(comment, task.id, pr.number, controlPlane),
  );
  if (parsed.some((item) => item.kind === 'malformed'))
    return { kind: 'ambiguous', reason: 'PRODUCT_AMBIGUITY' };
  const valid = parsed.filter(
    (item) =>
      item.kind === 'valid' &&
      item.REVIEWED_HEAD.toLowerCase() === pr.head.sha.toLowerCase() &&
      (!github.directiveMode || item.createdAt > context.createdAt),
  );
  if (valid.length === 0) return { kind: 'none' };
  const verdicts = new Set(valid.map((item) => item.VERDICT));
  if (verdicts.size > 1) return { kind: 'ambiguous', reason: 'PRODUCT_AMBIGUITY' };
  valid.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { kind: 'valid', verdict: valid.at(-1).VERDICT };
}

function latestApplicablePrCi(pr, github) {
  const attempts = pr.requiredCiAttempts || github.requiredPrCiAttempts || [];
  const exactHeadAttempts = attempts
    .filter((attempt) => attempt.headSha?.toLowerCase() === pr.head.sha.toLowerCase())
    .sort(
      (a, b) =>
        (b.runAttempt || 0) - (a.runAttempt || 0) ||
        (b.updatedAt || '').localeCompare(a.updatedAt || '') ||
        (b.runId || 0) - (a.runId || 0),
    );
  return exactHeadAttempts[0] || null;
}

function failedCheckIdentity(attempt) {
  return (
    attempt.failedCheck ||
    attempt.identity ||
    attempt.check ||
    attempt.job ||
    attempt.step ||
    'required-pr-ci'
  );
}

function parseRepairMarker(comment, task, pr, fingerprint, controlPlane) {
  if (!comment.topLevel || !comment.body?.includes(repairMarker)) return { kind: 'ignore' };
  if (!authorizedMarkerAuthor(comment, controlPlane, 'authorized_dispatcher_logins'))
    return { kind: 'ignore' };
  const fields = {};
  for (const line of comment.body.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+):\s*(.+?)\s*$/);
    if (match) fields[match[1]] = match[2];
  }
  const required = ['TASK', 'PR', 'HEAD', 'FAILED_CHECK', 'ACTION'];
  if (required.some((field) => !(field in fields))) return { kind: 'malformed' };
  if (
    fields.TASK !== task.id ||
    Number(fields.PR) !== pr.number ||
    fields.HEAD.toLowerCase() !== fingerprint.head.toLowerCase() ||
    fields.FAILED_CHECK !== fingerprint.failedCheck ||
    fields.ACTION !== 'LAUNCHED'
  )
    return { kind: 'other-event' };
  return { kind: 'valid', ...fields };
}

function repairLaunch(task, pr, failedCheck, reason, controlPlane) {
  const fingerprint = {
    task: task.id,
    pr: pr.number,
    head: pr.head.sha,
    failedCheck,
  };
  const markerBody = `${repairMarker}\nTASK: ${task.id}\nPR: ${pr.number}\nHEAD: ${pr.head.sha}\nFAILED_CHECK: ${failedCheck}\nACTION: LAUNCHED`;
  const matchingMarker = (pr.comments || []).some(
    (comment) => parseRepairMarker(comment, task, pr, fingerprint, controlPlane).kind === 'valid',
  );
  return {
    status: 'IN_PROGRESS',
    pr: pr.number,
    action: 'REPAIR_SAME_PR',
    repairLaunch: !matchingMarker,
    repairEvent: fingerprint,
    repairMarker: matchingMarker ? 'ALREADY_LAUNCHED' : markerBody,
    repairReason: reason,
    repairWorker: {
      profile: 'luna-high',
      taskCard: task.task_card,
      pr: pr.number,
      currentHead: pr.head.sha,
      failedCheck,
      instruction:
        'Keep the same canonical Task Card and repair the same PR; do not create a replacement PR.',
      maxTransientReruns: 1,
    },
  };
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
  if (!main?.sha || !pr.mergeCommitSha)
    return {
      kind: 'wait',
      detail: 'MAIN_CI_PENDING',
      mainSha: main?.sha,
      latestAttempt: null,
    };
  const acceptedMergeInAncestry = (main.ancestry || []).some(
    (sha) => sha.toLowerCase() === pr.mergeCommitSha.toLowerCase(),
  );
  if (!acceptedMergeInAncestry) return { kind: 'blocked', detail: 'MAIN_ANCESTRY_UNPROVEN' };
  const latestAttempt = latestApplicableMainCi(main);
  if (!latestAttempt || latestAttempt.status !== 'completed')
    return {
      kind: 'wait',
      detail: 'MAIN_CI_PENDING',
      mainSha: main.sha,
      latestAttempt: latestAttempt || null,
    };
  if (latestAttempt.conclusion === 'success')
    return { kind: 'success', mainSha: main.sha, latestAttempt };
  return { kind: 'blocked', detail: 'MAIN_VERIFY_FAILED', mainSha: main.sha, latestAttempt };
}

function acceptedImplementationMergeIsProven(pr, verdict) {
  return Boolean(
    pr?.merged === true &&
    pr.mergeCommitSha &&
    verdict.kind === 'valid' &&
    verdict.verdict === 'PASS',
  );
}

function projectStatus(task, pr, github, controlPlane = null) {
  if (!pr) return { status: 'IN_PROGRESS', pr: null, action: 'WAIT' };
  const verdict = currentVerdict(task, pr, github, controlPlane);
  if (verdict.kind === 'ambiguous')
    return { status: 'BLOCKED', pr: pr.number, error: 'PRODUCT_AMBIGUITY' };
  if (pr.merged) {
    if (verdict.kind !== 'valid' || verdict.verdict !== 'PASS')
      return { status: 'REVIEW', pr: pr.number, action: 'WAIT_FOR_VERDICT' };
    // PRE-MERGE MAIN-CI GUARD: never classify main CI until the accepted
    // implementation PR merge itself is durable and attributable.
    if (!acceptedImplementationMergeIsProven(pr, verdict))
      return {
        status: 'REVIEW',
        pr: pr.number,
        action: 'WAIT_FOR_MERGE_PROOF',
        detail: 'IMPLEMENTATION_PR_MERGE_UNPROVEN',
      };
    const mainVerification = verifyMergedMain(pr, github);
    if (mainVerification.kind === 'wait')
      return {
        status: 'REVIEW',
        pr: pr.number,
        action: 'WAIT_MAIN_CI',
        detail: mainVerification.detail,
        mainSha: mainVerification.mainSha,
        mainCiAttempt: mainVerification.latestAttempt,
      };
    if (mainVerification.kind === 'blocked')
      return {
        status: 'BLOCKED',
        pr: pr.number,
        error: 'TASK_BLOCKED',
        detail: mainVerification.detail,
        mainSha: mainVerification.mainSha || github.main?.sha,
        mainCiAttempt: mainVerification.latestAttempt,
      };
    return {
      status: 'DONE',
      pr: pr.number,
      action: task.next_task ? 'READY_PREDEFINED_NEXT' : 'DONE',
      nextTask: task.next_task,
      mainSha: mainVerification.mainSha,
      mainCiAttempt: mainVerification.latestAttempt,
    };
  }
  if (verdict.kind === 'valid' && verdict.verdict === 'PRODUCT_AMBIGUITY')
    return { status: 'BLOCKED', pr: pr.number, error: 'PRODUCT_AMBIGUITY' };
  if (verdict.kind === 'valid' && verdict.verdict === 'REQUEST_CHANGES')
    return repairLaunch(
      task,
      pr,
      'ARCHITECT_REQUEST_CHANGES',
      'ARCHITECT_REQUEST_CHANGES',
      controlPlane,
    );

  const prCi = latestApplicablePrCi(pr, github);
  if (!prCi || prCi.status !== 'completed')
    return {
      status: 'REVIEW',
      pr: pr.number,
      action: 'WAIT_PR_CI',
      detail: 'PR_CI_PENDING',
    };
  if (prCi.conclusion !== 'success')
    return repairLaunch(task, pr, failedCheckIdentity(prCi), 'PR_CI_FAILURE', controlPlane);
  if (verdict.kind === 'valid' && verdict.verdict === 'PASS') {
    if (!github.freshRead || github.freshHeadSha?.toLowerCase() !== pr.head.sha.toLowerCase())
      return { status: 'REVIEW', pr: pr.number, action: 'FRESH_HEAD_RECHECK_REQUIRED' };
    return { status: 'REVIEW', pr: pr.number, action: 'MERGE_ELIGIBLE_AFTER_FRESH_HEAD_RECHECK' };
  }
  return { status: 'REVIEW', pr: pr.number, action: 'WAIT_FOR_VERDICT' };
}

function prForTask(task, local, found, github) {
  const localPr = local.tasks?.[task.id]?.pr;
  return (
    (github.prs || []).find((candidate) => candidate.number === localPr) ||
    found.candidate?.pr ||
    null
  );
}

function reconcileProjectedDone(local, candidatesByTask, github, controlPlane) {
  for (const { task, found } of candidatesByTask) {
    if (local.tasks?.[task.id]?.status !== 'DONE') continue;
    if (found.kind === 'ambiguous')
      return {
        status: 'BLOCKED',
        canonicalTaskId: task.id,
        error: 'PRODUCT_AMBIGUITY',
        detail: 'equal PR candidates',
        candidates: found.candidates.map((item) => item.pr.number),
      };
    const result = projectStatus(task, prForTask(task, local, found, github), github, controlPlane);
    if (result.status !== 'DONE') return { canonicalTaskId: task.id, ...result };
  }
  return null;
}

function eligibleReadyTasks(canonicalQueue, local) {
  const canonicalTaskIds = new Set(canonicalQueue.map((task) => task.id));
  return canonicalQueue.filter((task) => {
    if (local.tasks?.[task.id]?.status !== 'READY') return false;
    return task.depends_on
      .filter((dependency) => canonicalTaskIds.has(dependency))
      .every((dependency) => local.tasks?.[dependency]?.status === 'DONE');
  });
}

function dispatchReadyTask(task) {
  return {
    canonicalTaskId: task.id,
    status: 'IN_PROGRESS',
    action: 'DISPATCH_READY',
    previousStatus: 'READY',
    pr: null,
    nextTask: task.next_task,
  };
}

function selectReadyTask(canonicalQueue, local) {
  const ready = eligibleReadyTasks(canonicalQueue, local);
  if (ready.length > 1)
    return {
      status: 'BLOCKED',
      error: 'TASK_BLOCKED',
      detail: 'DISPATCHER_STATE_INVALID',
      readyTasks: ready.map((task) => task.id),
    };
  return ready.length === 1 ? dispatchReadyTask(ready[0]) : null;
}

function reconcile(canonicalQueue, local, github, controlPlane = null) {
  const ids = assertCanonicalTopology(canonicalQueue);
  const byId = taskMap(canonicalQueue);
  const localId = local.activeTaskId;
  const invalidLocalId = Boolean(localId && !ids.has(localId));
  const directiveResult = reconcileDirective(canonicalQueue, local, github, controlPlane);
  if (directiveResult) return directiveResult;
  const candidatesByTask = canonicalQueue.map((task) => ({
    task,
    found: discoverUnique(task, github),
  }));
  const projectedDone = reconcileProjectedDone(local, candidatesByTask, github, controlPlane);
  if (projectedDone) return projectedDone;
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
  if (!selected)
    return (
      selectReadyTask(canonicalQueue, local) || { status: 'NO_READY_TASK', error: 'NO_READY_TASK' }
    );
  const task = selected.task;
  const localTask = local.tasks?.[task.id] || { pr: null };
  if (localTask.status === 'DONE') {
    const doneResult = projectStatus(
      task,
      prForTask(task, local, selected.found, github),
      github,
      controlPlane,
    );
    if (doneResult.status !== 'DONE') return { canonicalTaskId: task.id, ...doneResult };
    return selectReadyTask(canonicalQueue, local) || { canonicalTaskId: task.id, ...doneResult };
  }
  if (localTask.status === 'READY')
    return (
      selectReadyTask(canonicalQueue, local) || { status: 'NO_READY_TASK', error: 'NO_READY_TASK' }
    );
  const pr = prForTask(task, local, selected.found, github);
  const result = projectStatus(task, pr, github, controlPlane);
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

function machineBody(marker, fields, order) {
  return [marker, ...order.map((field) => `${field}: ${fields[field]}`)].join('\n');
}

function buildDirectiveScenario(protocol, overrides) {
  const base = protocol.base;
  const task = protocol.canonicalQueue[0];
  const runtimeStatus = overrides.runtime_status ?? base.runtime_status;
  const runtimePr = 'runtime_pr' in overrides ? overrides.runtime_pr : base.runtime_pr;
  const prNumber = 'pr_number' in overrides ? overrides.pr_number : base.pr_number;
  const head = 'head' in overrides ? overrides.head : base.head;
  const fields = {
    ...base.directive,
    DIRECTIVE_ID: overrides.directive_id ?? base.directive.DIRECTIVE_ID,
    TASK: overrides.directive_task ?? base.directive.TASK,
    PR: overrides.directive_pr ?? base.directive.PR,
    HEAD: overrides.directive_head ?? base.directive.HEAD,
    ADD_ALLOWED_FILES: overrides.add_allowed_files ?? base.directive.ADD_ALLOWED_FILES,
    ADD_REQUIRED_TESTS: overrides.add_required_tests ?? base.directive.ADD_REQUIRED_TESTS,
    INSTRUCTION: overrides.instruction ?? base.directive.INSTRUCTION,
    KEEP_SAME_PR: overrides.keep_same_pr ?? base.directive.KEEP_SAME_PR,
  };
  const comments = [];
  if (overrides.unauthorized_before_valid) {
    comments.push({
      id: 'I_kwDO_UNAUTHORIZED_BEFORE_VALID',
      topLevel: true,
      author: { login: 'untrusted-commenter' },
      createdAt: '2026-09-03T00:40:00Z',
      body: machineBody(
        directiveMarker,
        { ...fields, DIRECTIVE_ID: 'DIR-PFC07-UNAUTHORIZED' },
        directiveFields,
      ),
    });
  }
  if (overrides.malformed_before_valid) {
    comments.push({
      id: 'I_kwDO_MALFORMED_BEFORE_VALID',
      topLevel: true,
      author: { login: 'Li-Ming-G' },
      createdAt: '2026-09-03T00:45:00Z',
      body: `${directiveMarker}\nDIRECTIVE_ID: DIR-PFC07-MALFORMED\nTASK: ${task.id}\nPR: 133`,
    });
  }
  if (overrides.rejected_stale_before_valid) {
    const staleFields = {
      ...fields,
      DIRECTIVE_ID: 'DIR-PFC07-STALE-EVIDENCED',
      HEAD: '1111111111111111111111111111111111111111',
    };
    const staleDirective = {
      kind: 'valid',
      fields: staleFields,
      digest: directiveDigest(staleFields),
    };
    const staleIdentity = { id: staleFields.DIRECTIVE_ID, digest: staleDirective.digest };
    comments.push({
      id: 'I_kwDO_STALE_BEFORE_VALID',
      topLevel: true,
      author: { login: 'Li-Ming-G' },
      createdAt: '2026-09-03T00:30:00Z',
      body: machineBody(directiveMarker, staleFields, directiveFields),
    });
    comments.push({
      id: 'I_kwDO_STALE_REJECTION_ACK',
      topLevel: true,
      author: { login: 'Li-Ming-G' },
      createdAt: '2026-09-03T00:35:00Z',
      body: rejectionAckBody(
        staleIdentity,
        task,
        staleDirective,
        'REJECTED_STALE',
        'HEAD_MISMATCH',
      ),
    });
  }
  if (overrides.natural_language_only) {
    comments.push({
      id: 'I_kwDO_CURRENT_DIRECTIVE',
      topLevel: true,
      author: { login: 'Li-Ming-G' },
      createdAt: '2026-09-03T01:00:00Z',
      body: 'Please repair the current task. This prose is not a command.',
    });
  } else if (!overrides.omit_directive) {
    comments.push({
      id: 'I_kwDO_CURRENT_DIRECTIVE',
      topLevel: true,
      author: { login: overrides.architect_login || 'Li-Ming-G' },
      createdAt: '2026-09-03T01:00:00Z',
      body: machineBody(directiveMarker, fields, directiveFields),
    });
  }
  if (overrides.mutated_duplicate) {
    comments.push({
      id: 'I_kwDO_MUTATED_DUPLICATE',
      topLevel: true,
      author: { login: 'Li-Ming-G' },
      createdAt: '2026-09-03T01:01:00Z',
      body: machineBody(
        directiveMarker,
        { ...fields, INSTRUCTION: 'A different payload reusing the same identity.' },
        directiveFields,
      ),
    });
  }
  const directive = {
    kind: 'valid',
    fields,
    digest: directiveDigest(fields),
  };
  const appliedEnvelope = effectiveEnvelope(task, [], directive);
  if (overrides.successful_ack) {
    comments.push({
      topLevel: true,
      author: { login: 'Li-Ming-G' },
      createdAt: '2026-09-03T02:00:00Z',
      body: directiveAckBody(
        directive,
        task,
        base.pr_number,
        base.head,
        'LAUNCHED',
        'worker-0001',
        appliedEnvelope,
        'WORKER_LAUNCHED',
      ),
    });
  }
  for (let attempt = 1; attempt <= (overrides.launch_failures || 0); attempt += 1) {
    comments.push({
      topLevel: true,
      author: { login: 'Li-Ming-G' },
      createdAt: `2026-09-03T02:0${attempt}:00Z`,
      body: directiveAckBody(
        directive,
        task,
        base.pr_number,
        base.head,
        'LAUNCH_FAILED',
        'none',
        appliedEnvelope,
        `WORKER_LAUNCH_FAILED_ATTEMPT_${attempt}`,
      ),
    });
  }
  const prComments = [];
  if (overrides.existing_repair_marker)
    prComments.push({
      topLevel: true,
      author: { login: 'Li-Ming-G' },
      createdAt: '2026-09-03T00:10:00Z',
      body: `${repairMarker}\nTASK: ${task.id}\nPR: ${prNumber}\nHEAD: ${head}\nFAILED_CHECK: verify\nACTION: LAUNCHED`,
    });
  const contextFields = {
    TASK: task.id,
    PR: String(prNumber),
    CURRENT_HEAD: head,
    BASE_MAIN_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    TASK_CARD: task.task_card,
    ALLOWED_SCOPE: overrides.stale_review_context
      ? task.allowed_files.join(';')
      : appliedEnvelope.allowedFiles.join(';'),
    ACCEPTED_CONTRACTS: 'none declared in Task Card',
    REQUIRED_TESTS: overrides.stale_review_context
      ? task.required_tests.join(';')
      : appliedEnvelope.requiredTests.join(';'),
    APPLIED_DIRECTIVES: overrides.stale_review_context ? 'none' : fields.DIRECTIVE_ID,
  };
  if (overrides.valid_review_context || overrides.stale_review_context)
    prComments.push({
      topLevel: true,
      author: { login: overrides.review_context_login || 'Li-Ming-G' },
      createdAt: '2026-09-03T03:00:00Z',
      body: machineBody(reviewContextMarker, contextFields, Object.keys(contextFields)),
    });
  if (overrides.old_pass)
    prComments.push({
      topLevel: true,
      author: { login: overrides.verdict_login || 'Li-Ming-G' },
      createdAt: overrides.stale_review_context ? '2026-09-03T04:00:00Z' : '2026-09-03T00:30:00Z',
      body: `${verdictMarker}\nTASK: ${task.id}\nPR: ${prNumber}\nREVIEWED_HEAD: ${head}\nVERDICT: PASS\nP0: 0\nP1: 0\nP2: 0`,
    });
  const prs =
    prNumber === null
      ? []
      : [
          {
            number: prNumber,
            title: `[${task.id}] deterministic directive fixture`,
            body: task.id,
            head: { ref: 'codex/pfc-07-full-flow-e2e', sha: head },
            base: { ref: 'main' },
            state: 'open',
            merged: false,
            comments: prComments,
            requiredCiAttempts: [
              { headSha: head, runId: 13501, status: 'in_progress', conclusion: null },
            ],
          },
        ];
  return {
    local: {
      activeTaskId: task.id,
      tasks: { [task.id]: { status: runtimeStatus, pr: runtimePr } },
    },
    github: {
      prs,
      commandBus: { issue: 135, comments },
      directiveMode:
        overrides.valid_review_context || overrides.stale_review_context || overrides.old_pass,
      workers: overrides.existing_worker
        ? [
            {
              identity: `architect-directive/${task.id}/${fields.DIRECTIVE_ID}`,
              ref: 'worker-0001',
            },
          ]
        : [],
      nativeDirectiveLaunch: {
        completed: true,
        workerRef:
          overrides.launch_returns_stable_ref === false
            ? null
            : (overrides.launch_worker_ref ?? 'worker-created-0001'),
      },
      main: { status: 'pending' },
    },
    fields,
    appliedEnvelope,
  };
}

const activeControlPlane = await load('control-plane.json');
const stateSchema = await load('dispatcher-state.schema.json');
const canonicalState = await load('dispatcher-state.json');
const fixture = await load('fixtures/reconciliation-cases.json');
assert.equal(activeControlPlane.architect_directive_protocol, 'ARCHITECT_DIRECTIVE_V1');
assert.equal(activeControlPlane.architect_command_bus_issue, 135);
assert.equal(activeControlPlane.enabled, true);
assert(stateSchema.$defs.task.allOf[0].if.properties.status.enum.includes('READY'));
assert(!stateSchema.$defs.task.allOf[0].if.properties.status.enum.includes('BLOCKED'));
validateStateShape(canonicalState);
validateSmokeFixture();
const canonical = fixture.canonicalQueue;
const results = {};

const preMergeCanonical = fixture.preMergeMainCiCanonicalQueue;
const preMerge = fixture.preMergeMainCiCases;

results.preMergeMainFailureIgnored = reconcile(
  preMergeCanonical,
  preMerge.A_in_progress_main_failure.local,
  preMerge.A_in_progress_main_failure.github,
);
assert.equal(results.preMergeMainFailureIgnored.status, 'IN_PROGRESS');
assert.equal(results.preMergeMainFailureIgnored.action, 'WAIT');
assert.notEqual(results.preMergeMainFailureIgnored.detail, 'MAIN_VERIFY_FAILED');
assert.notEqual(results.preMergeMainFailureIgnored.status, 'DONE');

results.preMergeMainSuccessIgnored = reconcile(
  preMergeCanonical,
  preMerge.B_in_progress_main_success.local,
  preMerge.B_in_progress_main_success.github,
);
assert.equal(results.preMergeMainSuccessIgnored.status, 'IN_PROGRESS');
assert.equal(results.preMergeMainSuccessIgnored.action, 'WAIT');
assert.notEqual(results.preMergeMainSuccessIgnored.status, 'DONE');

results.staleDoneOpenPrRecovered = reconcile(
  preMergeCanonical,
  preMerge.C_stale_done_null_pr_open_pass.local,
  preMerge.C_stale_done_null_pr_open_pass.github,
);
assert.equal(results.staleDoneOpenPrRecovered.canonicalTaskId, 'CKPT-A-LEGACY-PREPARE-BRIDGE-01');
assert.equal(results.staleDoneOpenPrRecovered.pr, 123);
assert.equal(results.staleDoneOpenPrRecovered.status, 'REVIEW');
assert.equal(results.staleDoneOpenPrRecovered.action, 'MERGE_ELIGIBLE_AFTER_FRESH_HEAD_RECHECK');
assert.notEqual(results.staleDoneOpenPrRecovered.error, 'NO_READY_TASK');
assert.notEqual(results.staleDoneOpenPrRecovered.status, 'DONE');

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

const repairCanonical = fixture.repairCanonicalQueue;
const repair = fixture.repairCases;

const repairA = reconcile(
  repairCanonical,
  repair.A_pending_no_verdict.local,
  repair.A_pending_no_verdict.github,
);
assert.equal(repairA.status, 'REVIEW');
assert.equal(repairA.action, 'WAIT_PR_CI');
assert.equal(repairA.detail, 'PR_CI_PENDING');
assert.equal(repairA.repairLaunch, undefined);

const repairB = reconcile(
  repairCanonical,
  repair.B_failure_launches_repair.local,
  repair.B_failure_launches_repair.github,
);
assert.equal(repairB.canonicalTaskId, 'P4C-02');
assert.equal(repairB.pr, 202);
assert.equal(repairB.status, 'IN_PROGRESS');
assert.equal(repairB.action, 'REPAIR_SAME_PR');
assert.equal(repairB.repairLaunch, true);
assert.equal(repairB.repairEvent.failedCheck, 'lint');

const repairC = reconcile(
  repairCanonical,
  repair.C_matching_marker_dedupes.local,
  repair.C_matching_marker_dedupes.github,
);
assert.equal(repairC.status, 'IN_PROGRESS');
assert.equal(repairC.action, 'REPAIR_SAME_PR');
assert.equal(repairC.repairLaunch, false);
assert.equal(repairC.repairMarker, 'ALREADY_LAUNCHED');

const repairD = reconcile(
  repairCanonical,
  repair.D_new_head_is_new_event.local,
  repair.D_new_head_is_new_event.github,
);
assert.equal(repairD.status, 'IN_PROGRESS');
assert.equal(repairD.action, 'REPAIR_SAME_PR');
assert.equal(repairD.repairLaunch, true);
assert.equal(repairD.repairEvent.head, 'cccccccccccccccccccccccccccccccccccccccc');

const repairE = reconcile(
  repairCanonical,
  repair.E_request_changes_same_pr.local,
  repair.E_request_changes_same_pr.github,
);
assert.equal(repairE.status, 'IN_PROGRESS');
assert.equal(repairE.action, 'REPAIR_SAME_PR');
assert.equal(repairE.pr, 203);
assert.equal(repairE.repairLaunch, true);

const repairF = reconcile(
  repairCanonical,
  repair.F_success_no_verdict.local,
  repair.F_success_no_verdict.github,
);
assert.equal(repairF.status, 'REVIEW');
assert.equal(repairF.action, 'WAIT_FOR_VERDICT');
assert.equal(repairF.repairLaunch, undefined);

const repairG = reconcile(
  repairCanonical,
  repair.G_pass_success_merge_eligible.local,
  repair.G_pass_success_merge_eligible.github,
);
assert.equal(repairG.status, 'REVIEW');
assert.equal(repairG.action, 'MERGE_ELIGIBLE_AFTER_FRESH_HEAD_RECHECK');
assert.equal(repairG.repairLaunch, undefined);

const repairH = reconcile(
  repairCanonical,
  repair.H_pass_pending_no_merge.local,
  repair.H_pass_pending_no_merge.github,
);
assert.equal(repairH.status, 'REVIEW');
assert.equal(repairH.action, 'WAIT_PR_CI');
assert.notEqual(repairH.action, 'MERGE_ELIGIBLE_AFTER_FRESH_HEAD_RECHECK');

const repairI = reconcile(
  repairCanonical,
  repair.I_pass_failure_repairs.local,
  repair.I_pass_failure_repairs.github,
);
assert.equal(repairI.status, 'IN_PROGRESS');
assert.equal(repairI.action, 'REPAIR_SAME_PR');
assert.equal(repairI.repairLaunch, true);
assert.notEqual(repairI.action, 'MERGE_ELIGIBLE_AFTER_FRESH_HEAD_RECHECK');

const repairJ = reconcile(
  fixture.repairCanonicalQueue,
  repair.J_null_next_task_still_repairs.local,
  repair.J_null_next_task_still_repairs.github,
);
assert.equal(repairJ.status, 'IN_PROGRESS');
assert.equal(repairJ.action, 'REPAIR_SAME_PR');
assert.equal(repairJ.repairLaunch, true);
assert.equal(fixture.repairCanonicalQueue[1].next_task, null);

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

results.K_projectedDonePending = reconcile(
  canonical,
  fixture.cases.K_projected_done_main_pending.local,
  fixture.cases.K_projected_done_main_pending.github,
);
assert.equal(results.K_projectedDonePending.canonicalTaskId, 'P4C-02');
assert.equal(results.K_projectedDonePending.status, 'REVIEW');
assert.equal(results.K_projectedDonePending.action, 'WAIT_MAIN_CI');
assert.equal(results.K_projectedDonePending.detail, 'MAIN_CI_PENDING');
assert.equal(
  results.K_projectedDonePending.mainSha,
  fixture.cases.K_projected_done_main_pending.github.main.sha,
);

results.L_projectedDoneFailure = reconcile(
  canonical,
  fixture.cases.L_projected_done_main_failure.local,
  fixture.cases.L_projected_done_main_failure.github,
);
assert.equal(results.L_projectedDoneFailure.canonicalTaskId, 'P4C-02');
assert.equal(results.L_projectedDoneFailure.status, 'BLOCKED');
assert.equal(results.L_projectedDoneFailure.error, 'TASK_BLOCKED');
assert.equal(results.L_projectedDoneFailure.detail, 'MAIN_VERIFY_FAILED');
assert.equal(results.L_projectedDoneFailure.mainCiAttempt.conclusion, 'failure');

results.M_projectedDoneSuccess = reconcile(
  canonical,
  fixture.cases.M_projected_done_main_success.local,
  fixture.cases.M_projected_done_main_success.github,
);
assert.equal(results.M_projectedDoneSuccess.canonicalTaskId, 'P4C-02');
assert.equal(results.M_projectedDoneSuccess.status, 'DONE');
assert.equal(results.M_projectedDoneSuccess.action, 'READY_PREDEFINED_NEXT');

results.N_projectedDoneNullSuccessor = reconcile(
  canonical,
  fixture.cases.N_projected_done_null_successor_pending.local,
  fixture.cases.N_projected_done_null_successor_pending.github,
);
assert.equal(results.N_projectedDoneNullSuccessor.canonicalTaskId, 'P4C-04');
assert.equal(results.N_projectedDoneNullSuccessor.status, 'REVIEW');
assert.equal(results.N_projectedDoneNullSuccessor.action, 'WAIT_MAIN_CI');
assert.equal(results.N_projectedDoneNullSuccessor.detail, 'MAIN_CI_PENDING');
assert.notEqual(results.N_projectedDoneNullSuccessor.error, 'NO_READY_TASK');

results.O_staleDonePointer = reconcile(
  fixture.staleDoneCanonicalQueue,
  fixture.cases.O_stale_done_pointer_selects_ready.local,
  fixture.cases.O_stale_done_pointer_selects_ready.github,
);
assert.equal(results.O_staleDonePointer.canonicalTaskId, 'DISPATCHER-STALE-DONE-RECONCILIATION-01');
assert.equal(results.O_staleDonePointer.status, 'IN_PROGRESS');
assert.equal(results.O_staleDonePointer.action, 'DISPATCH_READY');
assert.equal(results.O_staleDonePointer.previousStatus, 'READY');
assert.equal(results.O_staleDonePointer.pr, null);

const directiveProtocol = fixture.directiveProtocol;
const directiveResults = {};
for (const [name, overrides] of Object.entries(directiveProtocol.cases)) {
  const scenario = buildDirectiveScenario(directiveProtocol, overrides);
  directiveResults[name] = {
    scenario,
    result: reconcile(
      directiveProtocol.canonicalQueue,
      scenario.local,
      scenario.github,
      activeControlPlane,
    ),
  };
}

const directiveA = directiveResults.A_valid_directive_launches.result;
assert.equal(directiveA.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveA.directiveLaunch, true);
assert.equal(directiveA.status, 'IN_PROGRESS');
assert.match(directiveA.ack, /ACTION: LAUNCHED/);

const directiveB = directiveResults.B_success_ack_dedupes.result;
assert.notEqual(directiveB.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.notEqual(directiveB.directiveLaunch, true);
assert.equal(directiveB.action, 'WAIT_PR_CI');

const directiveC = directiveResults.C_old_repair_plus_unique_directive.result;
assert.equal(directiveC.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveC.directiveLaunch, true);

const directiveD = directiveResults.D_stale_head_rejected.result;
assert.equal(directiveD.action, 'REJECTED_STALE');
assert.equal(directiveD.detail, 'HEAD_MISMATCH');
assert.equal(directiveD.directiveLaunch, false);

const directiveE = directiveResults.E_task_mismatch_rejected.result;
assert.equal(directiveE.action, 'REJECTED_INVALID');
assert.equal(directiveE.detail, 'TASK_MISMATCH');

const directiveF = directiveResults.F_pr_mismatch_rejected.result;
assert.equal(directiveF.action, 'REJECTED_STALE');
assert.equal(directiveF.detail, 'PR_MISMATCH');

const directiveG = directiveResults.G_null_pr_launches.result;
assert.equal(directiveG.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveG.pr, null);
assert.equal(directiveG.directiveLaunch, true);

const directiveH = directiveResults.H_blocked_recovers.result;
assert.equal(directiveH.previousStatus, 'BLOCKED');
assert.equal(directiveH.status, 'IN_PROGRESS');
assert.equal(directiveH.action, 'EXECUTE_ARCHITECT_DIRECTIVE');

const directiveI = directiveResults.I_add_allowed_file.result;
assert(
  directiveI.effectiveEnvelope.allowedFiles.includes(
    'apps/web/src/interview/new-interview-page.tsx',
  ),
);

const scenarioJ = directiveResults.J_overlay_survives_new_head.scenario;
const acksJ = successfulDirectiveAcks(
  scenarioJ.github.commandBus.comments,
  directiveProtocol.canonicalQueue[0].id,
  activeControlPlane,
);
const envelopeJ = effectiveEnvelope(directiveProtocol.canonicalQueue[0], acksJ);
assert(envelopeJ.allowedFiles.includes('apps/web/src/interview/new-interview-page.tsx'));
assert.equal(scenarioJ.github.prs[0].head.sha, '2222222222222222222222222222222222222222');

const directiveK = directiveResults.K_natural_language_inert.result;
assert.notEqual(directiveK.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveK.action, 'WAIT_PR_CI');

const scenarioL = directiveResults.L_review_context_effective.scenario;
const contextL = currentReviewContext(
  directiveProtocol.canonicalQueue[0],
  scenarioL.github.prs[0],
  scenarioL.github,
  activeControlPlane,
);
assert.equal(contextL.kind, 'valid');
assert.equal(contextL.fields.APPLIED_DIRECTIVES, 'DIR-PFC07-0001');
assert(contextL.fields.ALLOWED_SCOPE.includes('apps/web/src/interview/new-interview-page.tsx'));

const directiveM = directiveResults.M_new_directive_fences_old_pass.result;
assert.equal(directiveM.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveM.reviewFence, true);
const scenarioM = directiveResults.M_new_directive_fences_old_pass.scenario;
const nextHeadPr = {
  ...scenarioM.github.prs[0],
  head: { ...scenarioM.github.prs[0].head, sha: '3333333333333333333333333333333333333333' },
};
assert.equal(currentVerdict(directiveProtocol.canonicalQueue[0], nextHeadPr).kind, 'none');

const directiveN = directiveResults.N_directive_cannot_complete.result;
assert.equal(directiveN.status, 'IN_PROGRESS');
assert.notEqual(directiveN.status, 'DONE');
assert.notEqual(directiveN.action, 'MERGE_ELIGIBLE_AFTER_FRESH_HEAD_RECHECK');

const directiveO = directiveResults.O_legacy_deferred_header_runtime_active.result;
assert.equal(directiveProtocol.canonicalQueue[0].task_card_status, 'DEFERRED');
assert.equal(directiveO.status, 'IN_PROGRESS');
assert.notEqual(directiveO.error, 'PRODUCT_AMBIGUITY');

validateStateShape({
  $schema: './dispatcher-state.schema.json',
  queue: [
    {
      id: 'PFC-07-FULL-FLOW-E2E',
      status: 'BLOCKED',
      task_card: 'docs/agent/tasks/PFC-07-FULL-FLOW-E2E.md',
      worker_profile: 'luna-high',
      depends_on: ['PFC-07A-QUERY-MODE-NAV-STATE'],
      pr: 133,
      next_task: null,
    },
  ],
});
assert.equal(directiveResults.P_blocked_with_known_pr.result.status, 'IN_PROGRESS');

const directiveQ = directiveResults.Q_unauthorized_author.result;
assert.equal(directiveQ.action, 'WAIT_PR_CI');
assert.notEqual(directiveQ.action, 'REJECTED_INVALID');
assert.notEqual(directiveQ.directiveLaunch, true);

const directiveR = directiveResults.R_same_id_mutated_payload.result;
assert.equal(directiveR.status, 'BLOCKED');
assert.equal(directiveR.error, 'PRODUCT_AMBIGUITY');
assert.equal(directiveR.detail, 'DIRECTIVE_ID_PAYLOAD_CONFLICT');

const directiveS = directiveResults.S_half_null_pr_head.result;
assert.equal(directiveS.action, 'REJECTED_INVALID');
assert.equal(directiveS.detail, 'PR_HEAD_PAIR');

const directiveT = directiveResults.T_ack_loss_worker_recovery.result;
assert.equal(directiveT.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveT.directiveLaunch, false);
assert.match(directiveT.ack, /ACTION: APPLIED/);
assert.equal(directiveT.workerRef, 'worker-0001');

const scenarioU = directiveResults.U_stale_context_missing_directive.scenario;
assert.equal(
  currentReviewContext(
    directiveProtocol.canonicalQueue[0],
    scenarioU.github.prs[0],
    scenarioU.github,
    activeControlPlane,
  ).kind,
  'none',
);
assert.equal(
  currentVerdict(
    directiveProtocol.canonicalQueue[0],
    scenarioU.github.prs[0],
    scenarioU.github,
    activeControlPlane,
  ).kind,
  'none',
);

const directiveV = directiveResults.V_three_launch_failures_stop.result;
assert.equal(directiveV.status, 'BLOCKED');
assert.equal(directiveV.error, 'WORKER_FAILED');
assert.equal(directiveV.detail, 'DIRECTIVE_LAUNCH_ATTEMPTS_EXHAUSTED');
assert.equal(directiveV.directiveLaunch, false);

const directiveW = directiveResults.W_unauthorized_before_valid.result;
assert.equal(directiveW.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveW.directiveId, 'DIR-PFC07-0001');
assert.equal(directiveW.directiveLaunch, true);

const malformedScenario = directiveResults.X_malformed_before_valid.scenario;
const firstMalformedResult = directiveResults.X_malformed_before_valid.result;
assert.equal(firstMalformedResult.action, 'REJECTED_INVALID');
assert.equal(firstMalformedResult.detail, 'FIELD_SET');
assert.match(firstMalformedResult.rejectionIdentity, /^malformed:[0-9a-f]{64}$/);
assert.match(firstMalformedResult.ack, /ACTION: REJECTED_INVALID/);
const malformedComment = malformedScenario.github.commandBus.comments.find(
  (comment) => comment.id === 'I_kwDO_MALFORMED_BEFORE_VALID',
);
assert.deepEqual(
  malformedDirectiveIdentity(malformedComment),
  malformedDirectiveIdentity({ ...malformedComment }),
);
const recoveredMalformedScenario = structuredClone(malformedScenario);
recoveredMalformedScenario.github.commandBus.comments.push({
  id: 'I_kwDO_MALFORMED_REJECTION_ACK',
  topLevel: true,
  author: { login: activeControlPlane.authorized_dispatcher_logins[0] },
  createdAt: '2026-09-03T00:50:00Z',
  body: firstMalformedResult.ack,
});
const afterMalformedRejection = reconcile(
  directiveProtocol.canonicalQueue,
  recoveredMalformedScenario.local,
  recoveredMalformedScenario.github,
  activeControlPlane,
);
assert.equal(afterMalformedRejection.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(afterMalformedRejection.directiveId, 'DIR-PFC07-0001');

const directiveY = directiveResults.Y_rejected_stale_before_valid.result;
assert.equal(directiveY.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveY.directiveId, 'DIR-PFC07-0001');

const directiveZ = directiveResults.Z_launch_without_stable_ref_attempt_1.result;
assert.equal(directiveZ.status, 'IN_PROGRESS');
assert.equal(directiveZ.action, 'LAUNCH_FAILED');
assert.equal(directiveZ.launchAttempt, 1);
assert.equal(directiveZ.workerRef, null);
assert.match(directiveZ.ack, /ACTION: LAUNCH_FAILED/);
assert.match(directiveZ.ack, /WORKER_REF: none/);
assert.match(directiveZ.ack, /RESULT: WORKER_LAUNCH_FAILED_ATTEMPT_1/);

const directiveAA = directiveResults.AA_failure_then_late_worker.result;
assert.equal(directiveAA.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveAA.directiveLaunch, false);
assert.equal(directiveAA.workerRef, 'worker-0001');
assert.match(directiveAA.ack, /ACTION: APPLIED/);

const directiveAB = directiveResults.AB_attempt_2_launch_allowed.result;
assert.equal(directiveAB.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveAB.directiveLaunch, true);
assert.equal(directiveAB.launchAttempt, 2);
assert.match(directiveAB.ack, /ACTION: LAUNCHED/);

const directiveAC = directiveResults.AC_attempt_2_fails.result;
assert.equal(directiveAC.status, 'IN_PROGRESS');
assert.equal(directiveAC.action, 'LAUNCH_FAILED');
assert.equal(directiveAC.launchAttempt, 2);
assert.match(directiveAC.ack, /RESULT: WORKER_LAUNCH_FAILED_ATTEMPT_2/);

const directiveAD = directiveResults.AD_attempt_3_launch_allowed.result;
assert.equal(directiveAD.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveAD.directiveLaunch, true);
assert.equal(directiveAD.launchAttempt, 3);
assert.match(directiveAD.ack, /ACTION: LAUNCHED/);

const directiveAE = directiveResults.AE_attempt_3_failure_blocks.result;
assert.equal(directiveAE.status, 'BLOCKED');
assert.equal(directiveAE.action, 'WORKER_FAILED');
assert.equal(directiveAE.error, 'WORKER_FAILED');
assert.equal(directiveAE.launchAttempt, 3);
assert.match(directiveAE.ack, /ACTION: LAUNCH_FAILED/);
assert.match(directiveAE.ack, /RESULT: WORKER_LAUNCH_FAILED_ATTEMPT_3/);

const scenarioAF = directiveResults.AF_success_ack_preserves_envelope.scenario;
const acksAF = successfulDirectiveAcks(
  scenarioAF.github.commandBus.comments,
  directiveProtocol.canonicalQueue[0].id,
  activeControlPlane,
);
const envelopeAF = effectiveEnvelope(directiveProtocol.canonicalQueue[0], acksAF);
assert(envelopeAF.allowedFiles.includes('apps/web/src/interview/new-interview-page.tsx'));
assert(envelopeAF.requiredTests.includes('pnpm test:unit --run'));

const directiveAG = directiveResults.AG_existing_pfc07_directive_remains_valid.result;
assert.equal(directiveAG.action, 'EXECUTE_ARCHITECT_DIRECTIVE');
assert.equal(directiveAG.directiveId, 'PFC07-REPAIR-20260903-01');
assert.equal(directiveAG.launchAttempt, 1);
assert.match(directiveAG.ack, /ACTION: LAUNCHED/);
assert.equal(
  directiveResults.AG_existing_pfc07_directive_remains_valid.scenario.github.prs[0].head.sha,
  '8c9b7192376280b2e7860fc01bbb20afeb708802',
);

assert.doesNotMatch(
  JSON.stringify(Object.values(directiveResults).map(({ result }) => result)),
  /WORKER_SETUP_PENDING/,
);

const markerAuthFixture = fixture.prMarkerAuthentication;
assert.equal(
  markerAuthFixture.authorized_architect_login,
  activeControlPlane.authorized_architect_logins[0],
);
assert.equal(
  markerAuthFixture.authorized_dispatcher_login,
  activeControlPlane.authorized_dispatcher_logins[0],
);
assert.deepEqual(markerAuthFixture.cases, [
  'unauthorized_architect_verdict_is_inert',
  'unauthorized_review_context_is_inert',
  'unauthorized_repair_marker_is_inert',
]);

const markerTask = directiveProtocol.canonicalQueue[0];
const markerHead = directiveProtocol.base.head;
const markerPrNumber = directiveProtocol.base.pr_number;
const baseContextFields = {
  TASK: markerTask.id,
  PR: String(markerPrNumber),
  CURRENT_HEAD: markerHead,
  BASE_MAIN_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  TASK_CARD: markerTask.task_card,
  ALLOWED_SCOPE: markerTask.allowed_files.join(';'),
  ACCEPTED_CONTRACTS: 'none declared in Task Card',
  REQUIRED_TESTS: markerTask.required_tests.join(';'),
  APPLIED_DIRECTIVES: 'none',
};
const validPassBody = `${verdictMarker}\nTASK: ${markerTask.id}\nPR: ${markerPrNumber}\nREVIEWED_HEAD: ${markerHead}\nVERDICT: PASS\nP0: 0\nP1: 0\nP2: 0`;
const markerPr = (comments, conclusion = 'success') => ({
  number: markerPrNumber,
  head: { sha: markerHead },
  merged: false,
  comments,
  requiredCiAttempts: [
    {
      headSha: markerHead,
      runId: 13701,
      status: 'completed',
      conclusion,
      failedCheck: conclusion === 'success' ? undefined : 'verify',
    },
  ],
});
const authorizedContextComment = {
  topLevel: true,
  author: { login: markerAuthFixture.authorized_dispatcher_login },
  createdAt: '2026-09-03T05:00:00Z',
  body: machineBody(reviewContextMarker, baseContextFields, Object.keys(baseContextFields)),
};

const unauthorizedVerdictPr = markerPr([
  authorizedContextComment,
  {
    topLevel: true,
    author: { login: markerAuthFixture.unauthorized_login },
    createdAt: '2026-09-03T05:10:00Z',
    body: validPassBody,
  },
]);
const unauthorizedVerdictStatus = projectStatus(
  markerTask,
  unauthorizedVerdictPr,
  { directiveMode: true, commandBus: { comments: [] }, freshRead: true, freshHeadSha: markerHead },
  activeControlPlane,
);
assert.equal(unauthorizedVerdictStatus.action, 'WAIT_FOR_VERDICT');

const unauthorizedContextPr = markerPr([
  {
    ...authorizedContextComment,
    author: { login: markerAuthFixture.unauthorized_login },
  },
  {
    topLevel: true,
    author: { login: markerAuthFixture.authorized_architect_login },
    createdAt: '2026-09-03T05:10:00Z',
    body: validPassBody,
  },
]);
const unauthorizedContextGithub = {
  directiveMode: true,
  commandBus: { comments: [] },
  freshRead: true,
  freshHeadSha: markerHead,
};
assert.equal(
  currentReviewContext(
    markerTask,
    unauthorizedContextPr,
    unauthorizedContextGithub,
    activeControlPlane,
  ).kind,
  'none',
);
assert.equal(
  projectStatus(markerTask, unauthorizedContextPr, unauthorizedContextGithub, activeControlPlane)
    .action,
  'WAIT_FOR_VERDICT',
);

const unauthorizedRepairPr = markerPr(
  [
    {
      topLevel: true,
      author: { login: markerAuthFixture.unauthorized_login },
      body: `${repairMarker}\nTASK: ${markerTask.id}\nPR: ${markerPrNumber}\nHEAD: ${markerHead}\nFAILED_CHECK: verify\nACTION: LAUNCHED`,
    },
  ],
  'failure',
);
const unauthorizedRepairStatus = projectStatus(
  markerTask,
  unauthorizedRepairPr,
  {},
  activeControlPlane,
);
assert.equal(unauthorizedRepairStatus.action, 'REPAIR_SAME_PR');
assert.equal(unauthorizedRepairStatus.repairLaunch, true);

for (const result of Object.values(results)) {
  if (result.error) assert(stableErrors.has(result.error));
}

process.stdout.write(
  `${JSON.stringify(
    {
      result: 'PASS',
      cases: results,
      directiveCases: Object.fromEntries(
        Object.entries(directiveResults).map(([name, value]) => [name, value.result]),
      ),
    },
    null,
    2,
  )}\n`,
);
