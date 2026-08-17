import { createHash } from 'node:crypto';

export interface ContractValidationResult {
  valid: boolean;
  errors: readonly string[];
  verification: 'contract' | 'pending_runtime';
}

type JsonObject = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const LONG_FORBIDDEN = new Set([
  'value',
  'value_json',
  'resolved_value',
  'text',
  'raw_text',
  'transcript',
  'prompt',
  'context',
  'summary',
  'narrative',
  'provider_request',
  'provider_response',
  'provider_payload',
]);

export function sha256Canonical(parts: readonly (string | number | null)[]): string {
  return sha256CanonicalJson(parts);
}

export function sha256CanonicalJson(value: unknown): string {
  const canonical = JSON.stringify(sortJson(value));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function validateMemoryEvolutionPair(
  context: unknown,
  output: unknown,
): ContractValidationResult {
  const errors: string[] = [];
  const ctx = object(context);
  const out = object(output);
  if (ctx === null || out === null) return result(['EVOLUTION_OBJECT_REQUIRED']);
  const checkpoint = object(ctx.checkpoint);
  const members = array(checkpoint?.members);
  const candidates = array(ctx.layer_identities);
  const revisions = array(out.revision_candidates);
  if (checkpoint === null || members === null || candidates === null || revisions === null) {
    return result(['EVOLUTION_REQUIRED_COLLECTION']);
  }
  if (asString(out.checkpoint_id) !== asString(checkpoint.checkpoint_id))
    errors.push('EVOLUTION_CHECKPOINT_ID_MISMATCH');
  if (asString(ctx.project_id) === null || asString(ctx.source_session_id) === null)
    errors.push('EVOLUTION_SCOPE_REQUIRED');
  if (asString(checkpoint.source_working_snapshot_contract_version) !== 'memory-maintainer-v1.1')
    errors.push('EVOLUTION_SNAPSHOT_CONTRACT_MISMATCH');
  const policy = object(ctx.policy);
  if (asString(checkpoint.policy_revision) !== asString(policy?.policy_revision))
    errors.push('EVOLUTION_POLICY_DRIFT');
  if (asString(checkpoint.retention_policy_version) !== asString(policy?.retention_policy_version))
    errors.push('EVOLUTION_RETENTION_DRIFT');
  if (asString(policy?.deletion_scope_status) !== 'active')
    errors.push('EVOLUTION_DELETION_SCOPE_NOT_ACTIVE');
  if (asString(policy?.retention_status) !== 'active')
    errors.push('EVOLUTION_RETENTION_NOT_ACTIVE');
  const sourceIds = new Set<string>();
  const sourceMembers = new Map<string, JsonObject>();
  const orders: number[] = [];
  for (const item of members) {
    const m = object(item);
    const id = asString(m?.memory_resolution_id);
    const order = number(m?.input_order);
    if (id === null) errors.push('EVOLUTION_SOURCE_ID_REQUIRED');
    else if (sourceIds.has(id)) errors.push('EVOLUTION_SOURCE_ID_DUPLICATE');
    else {
      sourceIds.add(id);
      if (m !== null) sourceMembers.set(id, m);
    }
    if (order !== null) orders.push(order);
  }
  if (
    number(checkpoint.expected_member_count) !== members.length ||
    sourceIds.size !== members.length
  )
    errors.push('EVOLUTION_SOURCE_COUNT_UNIQUE_MISMATCH');
  if (!isContiguous(orders)) errors.push('EVOLUTION_SOURCE_ORDER_INVALID');
  if (stringDigest(checkpoint.member_manifest_hash) === null)
    errors.push('EVOLUTION_MANIFEST_DIGEST_INVALID');
  if (
    asString(checkpoint.manifest_algorithm_version) === 'memory-evolution-canonical-v1' &&
    asString(checkpoint.member_manifest_hash) !==
      sha256CanonicalJson(
        members.map((item) => {
          const member = object(item) ?? {};
          return [
            member.memory_resolution_id,
            member.resolution_revision,
            member.membership_digest,
            member.input_order,
          ];
        }),
      )
  )
    errors.push('EVOLUTION_SOURCE_MANIFEST_MISMATCH');
  const identityMap = new Map<string, JsonObject>();
  for (const item of candidates) {
    const identity = object(item);
    const id = asString(identity?.layer_identity_id);
    if (id !== null && identity !== null) {
      if (identityMap.has(id)) errors.push('EVOLUTION_IDENTITY_DUPLICATE');
      identityMap.set(id, identity);
      if (asString(identity.project_id) !== asString(ctx.project_id))
        errors.push('EVOLUTION_IDENTITY_PROJECT_MISMATCH');
      if (asString(identity.origin_session_id) !== asString(ctx.source_session_id))
        errors.push('EVOLUTION_IDENTITY_SESSION_MISMATCH');
    }
  }
  const candidateKeys = new Set<string>();
  for (const item of revisions) {
    const revision = object(item);
    const key = asString(revision?.candidate_key);
    if (key !== null && candidateKeys.has(key)) errors.push('EVOLUTION_CANDIDATE_DUPLICATE');
    if (key !== null) candidateKeys.add(key);
    const identityId = asString(revision?.layer_identity_id);
    const identity = identityId === null ? undefined : identityMap.get(identityId);
    if (!identity) errors.push('EVOLUTION_IDENTITY_UNKNOWN');
    const resolutionId = asString(revision?.source_resolution_id);
    if (resolutionId === null || !sourceIds.has(resolutionId))
      errors.push('EVOLUTION_RESOLUTION_NOT_IN_CHECKPOINT');
    if (identity && resolutionId !== asString(identity.origin_resolution_id))
      errors.push('EVOLUTION_IDENTITY_ORIGIN_MISMATCH');
    const source = resolutionId === null ? undefined : sourceMembers.get(resolutionId);
    if (
      source &&
      number(revision?.source_resolution_revision) !== number(source.resolution_revision)
    )
      errors.push('EVOLUTION_RESOLUTION_REVISION_MISMATCH');
    if (source && asString(revision?.source_semantic_status) !== asString(source.semantic_status))
      errors.push('EVOLUTION_RESOLUTION_SEMANTIC_STATUS_MISMATCH');
    const sourceClaimCount = source === undefined ? null : number(source.claim_count);
    if (sourceClaimCount === null) errors.push('EVOLUTION_CLAIM_COUNT_UNAVAILABLE');
    if (source && asString(source.boundary_status) === 'active')
      errors.push('EVOLUTION_BOUNDARY_MUST_NOT_PROMOTE');
    const checkpointRefs = array(revision?.checkpoint_member_refs) ?? [];
    if (checkpointRefs.length !== members.length) errors.push('EVOLUTION_CHECKPOINT_MEMBER_PARITY');
    for (let index = 0; index < members.length; index += 1) {
      const expected = object(members[index]);
      const actual = object(checkpointRefs[index]);
      if (
        !expected ||
        !actual ||
        asString(actual.memory_resolution_id) !== asString(expected.memory_resolution_id) ||
        number(actual.resolution_revision) !== number(expected.resolution_revision) ||
        asString(actual.semantic_status) !== asString(expected.semantic_status) ||
        number(actual.claim_count) !== number(expected.claim_count) ||
        asString(actual.boundary_status) !== asString(expected.boundary_status) ||
        asString(actual.membership_digest) !== asString(expected.membership_digest) ||
        number(actual.input_order) !== number(expected.input_order)
      )
        errors.push('EVOLUTION_CHECKPOINT_MEMBER_MISMATCH');
    }
    const revisionMembers = array(revision?.members) ?? [];
    const memberOrders = revisionMembers
      .map((m) => number(object(m)?.input_order))
      .filter((v): v is number => v !== null);
    if (
      number(revision?.expected_member_count) !== revisionMembers.length ||
      !isContiguous(memberOrders)
    )
      errors.push('EVOLUTION_OUTPUT_MEMBER_PARITY');
    if (
      asString(revision?.manifest_algorithm_version) === 'memory-evolution-canonical-v1' &&
      asString(revision?.member_manifest_hash) !==
        sha256CanonicalJson(
          revisionMembers.map((item) => {
            const member = object(item) ?? {};
            return [
              member.memory_claim_id,
              member.role,
              member.input_order,
              member.evidence_membership_digest,
            ];
          }),
        )
    )
      errors.push('EVOLUTION_OUTPUT_MANIFEST_MISMATCH');
    if (
      asString(revision?.predecessor_layer_revision_id) !== null &&
      asString(revision?.predecessor_layer_revision_id) === asString(revision?.layer_identity_id)
    )
      errors.push('EVOLUTION_PREDECESSOR_IDENTITY_COLLISION');
    const trigger = object(ctx.trigger);
    if (
      asString(trigger?.kind) === 'capacity_checkpoint' &&
      asString(revision?.hierarchy_consequence) === 'parked_to_mid'
    )
      errors.push('EVOLUTION_CAPACITY_MUST_NOT_PARK');
    if (
      asString(trigger?.kind) === 'semantic_park' &&
      asString(checkpoint.source_thread_status) !== 'parked'
    )
      errors.push('EVOLUTION_PARK_SOURCE_NOT_PARKED');
    if (
      asString(trigger?.kind) === 'session_final_flush' &&
      asString(checkpoint.source_p1_final_status) !== 'succeeded'
    )
      errors.push('EVOLUTION_FINAL_TERMINAL_REQUIRED');
    if (asString(revision?.source_semantic_status) === 'unavailable')
      errors.push('EVOLUTION_SEMANTIC_UNAVAILABLE');
    if (sourceClaimCount !== null && revisionMembers.length < sourceClaimCount)
      errors.push('EVOLUTION_CLAIM_COUNT_MISMATCH');
    if (asString(revision?.source_semantic_status) === 'disputed') {
      const claims = new Set(
        revisionMembers
          .map((member) => asString(object(member)?.memory_claim_id))
          .filter((id): id is string => id !== null),
      );
      if (claims.size < Math.max(2, sourceClaimCount ?? 2))
        errors.push('EVOLUTION_DISPUTED_CLAIMS_REQUIRED');
    }
    if (Array.isArray(revision?.boundary_effects) && revision.boundary_effects.length > 0)
      errors.push('EVOLUTION_BOUNDARY_MUST_NOT_PROMOTE');
  }
  return result(errors);
}

export function validateLongConsolidationPair(
  context: unknown,
  output: unknown,
): ContractValidationResult {
  const errors: string[] = [];
  const ctx = object(context);
  const out = object(output);
  if (!ctx || !out) return result(['LONG_OBJECT_REQUIRED']);
  const source = object(ctx.p2_final_checkpoint);
  const manifest = object(ctx.mid_manifest);
  const job = object(out.long_job);
  if (!source || !manifest || !job) return result(['LONG_REQUIRED_COLLECTION']);
  if (asString(source.terminal_status) !== 'succeeded') errors.push('LONG_FINAL_TERMINAL_REQUIRED');
  if (asString(job.source_final_checkpoint_id) !== asString(source.checkpoint_id))
    errors.push('LONG_CHECKPOINT_MISMATCH');
  if (asString(job.source_mid_manifest_hash) !== asString(manifest.revision_manifest_hash))
    errors.push('LONG_MID_MANIFEST_HASH_MISMATCH');
  const policy = object(ctx.policy);
  if (asString(policy?.deletion_scope_status) !== 'active')
    errors.push('LONG_DELETION_SCOPE_NOT_ACTIVE');
  if (asString(policy?.retention_status) !== 'active') errors.push('LONG_RETENTION_NOT_ACTIVE');
  if (
    asString(ctx.project_id) !== asString(object(job.source_scope)?.project_id) &&
    object(job.source_scope) !== null
  )
    errors.push('LONG_PROJECT_MISMATCH');
  const midRows = array(manifest.revisions) ?? [];
  if (
    number(manifest.expected_revision_count) !== midRows.length ||
    !isContiguous(
      midRows.map((r) => number(object(r)?.input_order)).filter((v): v is number => v !== null),
    )
  )
    errors.push('LONG_MID_MANIFEST_PARITY');
  const sourceIds = new Set(
    midRows
      .map((r) => asString(object(r)?.layer_revision_id))
      .filter((v): v is string => v !== null),
  );
  if (sourceIds.size !== midRows.length) errors.push('LONG_MID_SOURCE_DUPLICATE');
  if (
    asString(manifest.manifest_algorithm_version) === 'memory-evolution-canonical-v1' &&
    asString(manifest.revision_manifest_hash) !==
      sha256CanonicalJson(
        midRows.map((row) => {
          const mid = object(row) ?? {};
          return [
            mid.layer_revision_id,
            mid.layer_identity_id,
            mid.resolution_id,
            mid.resolution_revision,
            mid.semantic_status,
            mid.boundary_status,
            mid.membership_digest,
            mid.input_order,
            mid.source_job_id,
          ];
        }),
      )
  )
    errors.push('LONG_MID_MANIFEST_HASH_INVALID');
  const midByRevisionId = new Map<string, JsonObject>();
  for (const row of midRows) {
    const mid = object(row);
    const midId = asString(mid?.layer_revision_id);
    if (midId !== null && mid !== null) midByRevisionId.set(midId, mid);
    if (asString(mid?.project_id) !== asString(ctx.project_id))
      errors.push('LONG_MID_SCOPE_MISMATCH');
    if (asString(mid?.source_session_id) !== asString(ctx.source_session_id))
      errors.push('LONG_MID_CROSS_SESSION');
    if (asString(mid?.boundary_status) === 'active') errors.push('LONG_BOUNDARY_MUST_NOT_PROMOTE');
    if (asString(mid?.semantic_status) === 'disputed' && (number(mid?.claim_count) ?? 0) < 2)
      errors.push('LONG_DISPUTED_CLAIMS_REQUIRED');
  }
  const outputRows = array(out.revision_candidates) ?? [];
  const referencedMidIds: string[] = [];
  for (const row of outputRows) {
    const rev = object(row);
    if (!rev) {
      errors.push('LONG_REVISION_OBJECT_REQUIRED');
      continue;
    }
    if (asString(rev.target_layer) !== 'long') errors.push('LONG_TARGET_LAYER_INVALID');
    for (const id of array(rev.source_mid_revision_ids) ?? []) {
      const value = String(id);
      referencedMidIds.push(value);
      if (!sourceIds.has(value)) errors.push('LONG_SOURCE_REVISION_UNKNOWN');
      const mid = midByRevisionId.get(value);
      if (mid !== undefined) {
        if (asString(rev.layer_identity_id) !== asString(mid.layer_identity_id))
          errors.push('LONG_LAYER_IDENTITY_MISMATCH');
        if (asString(rev.source_resolution_id) !== asString(mid.resolution_id))
          errors.push('LONG_RESOLUTION_ID_MISMATCH');
        if (number(rev.source_resolution_revision) !== number(mid.resolution_revision))
          errors.push('LONG_RESOLUTION_REVISION_MISMATCH');
        if (asString(rev.source_semantic_status) !== asString(mid.semantic_status))
          errors.push('LONG_SEMANTIC_STATUS_MISMATCH');
      }
    }
    const orders = (array(rev.members) ?? [])
      .map((m) => number(object(m)?.input_order))
      .filter((v): v is number => v !== null);
    if (number(rev.expected_member_count) !== orders.length || !isContiguous(orders))
      errors.push('LONG_OUTPUT_MEMBER_PARITY');
    if (
      asString(rev.manifest_algorithm_version) === 'memory-evolution-canonical-v1' &&
      asString(rev.member_manifest_hash) !==
        sha256CanonicalJson(
          (array(rev.members) ?? []).map((item) => {
            const member = object(item) ?? {};
            return [
              member.memory_claim_id,
              member.role,
              member.input_order,
              member.evidence_membership_digest,
            ];
          }),
        )
    )
      errors.push('LONG_OUTPUT_MANIFEST_MISMATCH');
  }
  const orderedMidIds = midRows
    .slice()
    .sort(
      (left, right) =>
        (number(object(left)?.input_order) ?? -1) - (number(object(right)?.input_order) ?? -1),
    )
    .map((row) => asString(object(row)?.layer_revision_id))
    .filter((id): id is string => id !== null);
  if (
    referencedMidIds.length !== orderedMidIds.length ||
    referencedMidIds.some((id, index) => id !== orderedMidIds[index])
  )
    errors.push('LONG_SOURCE_REVISION_SET_MISMATCH');
  if (findForbiddenKey(ctx) || findForbiddenKey(out)) errors.push('LONG_RAW_CONTENT_FORBIDDEN');
  return result(errors);
}

export function validateDecisionTraceV11(
  trace: unknown,
  expected?: { output?: unknown; terminalStatus?: string },
): ContractValidationResult {
  const errors: string[] = [];
  const value = object(trace);
  if (!value) return result(['TRACE_OBJECT_REQUIRED']);
  const rows = array(value.memory_memberships) ?? [];
  const orders = rows
    .map((r) => number(object(r)?.input_order))
    .filter((v): v is number => v !== null);
  const ids = new Set(
    rows.map((r) => asString(object(r)?.layer_revision_id)).filter((v): v is string => v !== null),
  );
  if (ids.size !== rows.length) errors.push('TRACE_MEMBER_DUPLICATE');
  if (!isContiguous(orders)) errors.push('TRACE_ORDER_INVALID');
  if (
    value.expected_member_count !== undefined &&
    number(value.expected_member_count) !== rows.length
  )
    errors.push('TRACE_COUNT_MISMATCH');
  if (findForbiddenKey(value)) errors.push('TRACE_RAW_CONTENT_FORBIDDEN');
  if (expected?.terminalStatus && asString(value.terminal_status) !== expected.terminalStatus)
    errors.push('TRACE_TERMINAL_OUTCOME_MISMATCH');
  const roots = object(value.roots);
  const snapshot = object(roots?.source_working_snapshot);
  const checkpoint = object(roots?.checkpoint);
  const retention = object(roots?.retention);
  const kind = asString(value.trace_kind);
  if (kind !== 'question_orchestration' && checkpoint === null)
    errors.push('TRACE_CHECKPOINT_REQUIRED');
  if (
    asString(snapshot?.status) !== 'active' ||
    asString(checkpoint?.status) === 'hidden' ||
    asString(checkpoint?.status) === 'detached' ||
    asString(retention?.status) !== 'active' ||
    asString(retention?.deletion_scope_status) !== 'active'
  )
    errors.push('TRACE_ROOT_NOT_READABLE');
  if (
    asString(snapshot?.project_id) !== asString(value.project_id) ||
    asString(snapshot?.session_id) !== asString(value.session_id)
  )
    errors.push('TRACE_ROOT_SCOPE_MISMATCH');
  const checkpointResolutionIds = new Set((array(checkpoint?.resolution_ids) ?? []).map(String));
  const checkpointIdentityIds = new Set((array(checkpoint?.layer_identity_ids) ?? []).map(String));
  const checkpointRevisionIds = new Set((array(checkpoint?.layer_revision_ids) ?? []).map(String));
  if (
    checkpointResolutionIds.size !== (array(checkpoint?.resolution_ids) ?? []).length ||
    checkpointIdentityIds.size !== (array(checkpoint?.layer_identity_ids) ?? []).length ||
    checkpointRevisionIds.size !== (array(checkpoint?.layer_revision_ids) ?? []).length
  )
    errors.push('TRACE_ROOT_ID_DUPLICATE');
  const checkpointMembershipRefs = array(checkpoint?.membership_refs) ?? [];
  if (checkpointMembershipRefs.length !== rows.length)
    errors.push('TRACE_ROOT_MEMBERSHIP_COUNT_MISMATCH');
  const checkpointRefsByRevision = new Map<string, JsonObject>();
  for (const ref of checkpointMembershipRefs) {
    const item = object(ref);
    const id = asString(item?.layer_revision_id);
    if (id === null || item === null) errors.push('TRACE_ROOT_MEMBERSHIP_REF_INVALID');
    else if (checkpointRefsByRevision.has(id)) errors.push('TRACE_ROOT_MEMBERSHIP_DUPLICATE');
    else checkpointRefsByRevision.set(id, item);
  }
  const jobId = asString(object(roots?.ai_job)?.job_id);
  for (const row of rows) {
    const membership = object(row);
    if (!membership) continue;
    if (asString(membership.source_job_id) !== jobId) errors.push('TRACE_SOURCE_JOB_MISMATCH');
    if (
      asString(membership.project_id) !== asString(value.project_id) ||
      asString(membership.session_id) !== asString(value.session_id)
    )
      errors.push('TRACE_MEMBERSHIP_SCOPE_MISMATCH');
    if (!checkpointResolutionIds.has(String(membership.resolution_id)))
      errors.push('TRACE_RESOLUTION_REF_UNKNOWN');
    if (!checkpointIdentityIds.has(String(membership.layer_identity_id)))
      errors.push('TRACE_LAYER_IDENTITY_REF_UNKNOWN');
    if (!checkpointRevisionIds.has(String(membership.layer_revision_id)))
      errors.push('TRACE_LAYER_REVISION_REF_UNKNOWN');
    const rootRef = checkpointRefsByRevision.get(String(membership.layer_revision_id));
    if (rootRef === undefined) errors.push('TRACE_ROOT_MEMBERSHIP_REF_UNKNOWN');
    else {
      for (const key of [
        'layer_identity_id',
        'layer',
        'project_id',
        'session_id',
        'resolution_id',
        'resolution_revision',
        'membership_digest',
        'role',
        'input_order',
        'source_job_id',
      ]) {
        if (String(rootRef[key]) !== String(membership[key]))
          errors.push('TRACE_MEMBERSHIP_ROOT_PARITY');
      }
    }
  }
  if (
    kind !== 'question_orchestration' &&
    (value.decision_outcome !== undefined || value.director_invoked !== undefined)
  )
    errors.push('TRACE_QUESTION_FIELDS_ON_MEMORY_TRACE');
  return result(errors);
}

export function runtimeAssertionsPending(): ContractValidationResult {
  return { valid: true, errors: [], verification: 'pending_runtime' };
}

function result(errors: string[]): ContractValidationResult {
  return { valid: errors.length === 0, errors: [...new Set(errors)], verification: 'contract' };
}
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}
function array(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
function stringDigest(value: unknown): string | null {
  return typeof value === 'string' && DIGEST.test(value) ? value : null;
}
function isContiguous(values: number[]): boolean {
  return (
    values.length > 0 &&
    new Set(values).size === values.length &&
    values.every((value, index) => value === index)
  );
}
function findForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(findForbiddenKey);
  const obj = object(value);
  if (!obj) return false;
  return Object.entries(obj).some(
    ([key, child]) => LONG_FORBIDDEN.has(key) || findForbiddenKey(child),
  );
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  const obj = object(value);
  if (!obj) return value;
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((key) => [key, sortJson(obj[key])]),
  );
}

export { UUID, DIGEST };
