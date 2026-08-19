import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

export interface PersistenceValidationResult {
  valid: boolean;
  errors: readonly string[];
  verification: 'contract';
}

type Obj = Record<string, unknown>;
type SchemaValidator = (value: unknown) => boolean;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY_KEYS = new Set([
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

const EXPECTED_FOREIGN_KEYS = new Map<string, string>([
  ['checkpoint_project_fk', 'checkpoint.project_id|elder_project.id|false|RESTRICT'],
  ['checkpoint_session_fk', 'checkpoint.source_session_id|interview_session.id|false|RESTRICT'],
  [
    'revision_identity_fk',
    'layer_revision.layer_identity_id|layer_identity.layer_identity_id|false|RESTRICT',
  ],
  [
    'revision_checkpoint_fk',
    'layer_revision.source_checkpoint_id|checkpoint.checkpoint_id|false|RESTRICT',
  ],
  ['revision_job_fk', 'layer_revision.source_job_id|ai_job.id|false|RESTRICT'],
  [
    'revision_resolution_fk',
    'layer_revision.resolution_id|memory_resolution.resolution_id|false|RESTRICT',
  ],
  [
    'revision_predecessor_fk',
    'layer_revision.predecessor_layer_revision_id|layer_revision.layer_revision_id|true|RESTRICT',
  ],
  [
    'revision_member_revision_fk',
    'revision_member.layer_revision_id|layer_revision.layer_revision_id|false|RESTRICT',
  ],
  [
    'revision_member_claim_fk',
    'revision_member.memory_claim_id|memory_claim.claim_id|false|RESTRICT',
  ],
  [
    'evidence_bridge_authority_fk',
    'evidence_bridge.evidence_id|evidence_authority.evidence_id|false|RESTRICT',
  ],
  ['retention_cleanup_job_fk', 'retention_root.cleanup_job_id|ai_job.id|true|SET_NULL'],
  [
    'job_source_checkpoint_fk',
    'ai_job.source_checkpoint_id|checkpoint.checkpoint_id|false|RESTRICT',
  ],
  [
    'job_target_revision_fk',
    'ai_job.target_layer_revision_id|layer_revision.layer_revision_id|false|RESTRICT',
  ],
  [
    'long_projection_target_revision_fk',
    'long_projection.target_layer_revision_id|layer_revision.layer_revision_id|false|RESTRICT',
  ],
  [
    'retention_target_policy',
    'retention_root.target_id|typed_retention_target.reference|false|RESTRICT',
  ],
  ['trace_authority_fk', 'trace_authority.trace_id|decision_trace.id|false|RESTRICT'],
]);

let compiledSchema: SchemaValidator | undefined;

export function validateMemoryPersistenceManifest(input: unknown): PersistenceValidationResult {
  if (!schemaValidator()(input)) return result(['PERSISTENCE_SCHEMA_INVALID']);
  const root = obj(input);
  if (!root) return result(['PERSISTENCE_OBJECT_REQUIRED']);
  const errors: string[] = [];
  const scope = requiredObj(root.scope);
  const policy = requiredObj(root.policy);
  const checkpoint = requiredObj(root.checkpoint);
  const projectId = string(scope.project_id);
  const sourceSessionId = string(scope.source_session_id);
  const scopeSessionIds = strings(scope.source_session_ids);

  if (!scopeSessionIds.includes(sourceSessionId))
    errors.push('PERSISTENCE_SCOPE_SOURCE_SESSION_MISSING');
  if (string(policy.deletion_scope_status) !== 'active')
    errors.push('PERSISTENCE_DELETION_SCOPE_NOT_ACTIVE');
  if (string(policy.retention_status) !== 'active') errors.push('PERSISTENCE_RETENTION_NOT_ACTIVE');
  if (
    string(checkpoint.project_id) !== projectId ||
    string(checkpoint.source_session_id) !== sourceSessionId
  )
    errors.push('PERSISTENCE_CHECKPOINT_SCOPE_MISMATCH');
  if (string(checkpoint.policy_revision) !== string(policy.policy_revision))
    errors.push('PERSISTENCE_POLICY_DRIFT');
  if (string(checkpoint.retention_policy_version) !== string(policy.retention_policy_version))
    errors.push('PERSISTENCE_RETENTION_DRIFT');
  if (
    string(checkpoint.root_identity) !==
    canonicalDigest([
      checkpoint.checkpoint_id,
      checkpoint.project_id,
      checkpoint.source_session_id,
      checkpoint.expected_member_count,
      checkpoint.member_manifest_hash,
      checkpoint.source_p1_final_job_id,
      checkpoint.policy_revision,
      checkpoint.retention_policy_version,
    ])
  )
    errors.push('PERSISTENCE_CHECKPOINT_ROOT_IDENTITY_MISMATCH');

  const checkpointMembers = objects(root.checkpoint_members);
  const checkpointResolutionIds = uniqueIds(
    checkpointMembers,
    'resolution_id',
    errors,
    'PERSISTENCE_CHECKPOINT_RESOLUTION_DUPLICATE',
  );
  if (
    number(checkpoint.expected_member_count) !== checkpointMembers.length ||
    !contiguous(checkpointMembers)
  )
    errors.push('PERSISTENCE_CHECKPOINT_MEMBER_PARITY');
  if (
    string(checkpoint.member_manifest_hash) !==
    canonicalDigest(
      checkpointMembers.map((member) => [
        member.resolution_id,
        member.resolution_revision,
        member.semantic_status,
        member.claim_count,
        member.boundary_status,
        member.membership_digest,
        member.input_order,
      ]),
    )
  )
    errors.push('PERSISTENCE_CHECKPOINT_MANIFEST_MISMATCH');

  const claims = objects(root.claim_authorities);
  const resolutions = objects(root.resolution_authorities);
  const claimById = uniqueMap(claims, 'claim_id', errors, 'PERSISTENCE_CLAIM_AUTHORITY_DUPLICATE');
  const resolutionById = uniqueMap(
    resolutions,
    'resolution_id',
    errors,
    'PERSISTENCE_RESOLUTION_AUTHORITY_DUPLICATE',
  );
  for (const resolution of resolutions) {
    if (
      string(resolution.project_id) !== projectId ||
      !scopeSessionIds.includes(string(resolution.source_session_id))
    )
      errors.push('PERSISTENCE_RESOLUTION_SCOPE_MISMATCH');
    const authorityClaimIds = strings(resolution.claim_ids);
    const resolutionMembershipDigest = canonicalDigest(
      authorityClaimIds.map((claimId) => {
        const claim = claimById.get(claimId);
        return [claimId, claim?.claim_revision, claim?.evidence_manifest_hash];
      }),
    );
    if (string(resolution.membership_digest) !== resolutionMembershipDigest)
      errors.push('PERSISTENCE_RESOLUTION_MEMBERSHIP_DIGEST_MISMATCH');
    for (const claimId of authorityClaimIds) {
      const claim = claimById.get(claimId);
      if (!claim || string(claim.resolution_id) !== string(resolution.resolution_id))
        errors.push('PERSISTENCE_RESOLUTION_CLAIM_REFERENCE_INVALID');
    }
  }
  for (const claim of claims) {
    const resolution = resolutionById.get(string(claim.resolution_id));
    if (!resolution) errors.push('PERSISTENCE_CLAIM_RESOLUTION_UNKNOWN');
    if (
      string(claim.project_id) !== projectId ||
      !scopeSessionIds.includes(string(claim.source_session_id))
    )
      errors.push('PERSISTENCE_CLAIM_SCOPE_MISMATCH');
    if (!resolution || !strings(resolution.claim_ids).includes(string(claim.claim_id)))
      errors.push('PERSISTENCE_CLAIM_NOT_IN_RESOLUTION');
  }
  for (const member of checkpointMembers) {
    const authority = resolutionById.get(string(member.resolution_id));
    if (!authority || !checkpointResolutionIds.has(string(member.resolution_id)))
      errors.push('PERSISTENCE_CHECKPOINT_RESOLUTION_UNKNOWN');
    else if (
      number(member.resolution_revision) !== number(authority.resolution_revision) ||
      string(member.semantic_status) !== string(authority.semantic_status) ||
      string(member.boundary_status) !== string(authority.boundary_status) ||
      number(member.claim_count) !== strings(authority.claim_ids).length ||
      string(member.membership_digest) !== string(authority.membership_digest) ||
      string(authority.source_session_id) !== string(checkpoint.source_session_id) ||
      string(authority.project_id) !== string(checkpoint.project_id)
    )
      errors.push('PERSISTENCE_CHECKPOINT_AUTHORITY_MISMATCH');
  }

  const identities = objects(root.layer_identities);
  const identityById = uniqueMap(
    identities,
    'layer_identity_id',
    errors,
    'PERSISTENCE_IDENTITY_DUPLICATE',
  );
  const identityTuples = new Set<string>();
  for (const identity of identities) {
    const tuple = [
      identity.project_id,
      identity.origin_session_id,
      identity.origin_thread_id,
      identity.origin_resolution_id,
    ];
    const tupleKey = JSON.stringify(tuple);
    if (identityTuples.has(tupleKey)) errors.push('PERSISTENCE_IDENTITY_TUPLE_DUPLICATE');
    identityTuples.add(tupleKey);
    if (string(identity.identity_key_digest) !== canonicalDigest(tuple))
      errors.push('PERSISTENCE_IDENTITY_DIGEST_MISMATCH');
    const authority = resolutionById.get(string(identity.origin_resolution_id));
    if (
      string(identity.project_id) !== projectId ||
      !scopeSessionIds.includes(string(identity.origin_session_id)) ||
      !resolutionById.has(string(identity.origin_resolution_id))
    )
      errors.push('PERSISTENCE_IDENTITY_AUTHORITY_MISMATCH');
    if (
      !authority ||
      string(authority.project_id) !== string(identity.project_id) ||
      string(authority.source_session_id) !== string(identity.origin_session_id)
    )
      errors.push('PERSISTENCE_IDENTITY_ORIGIN_AUTHORITY_MISMATCH');
  }

  const revisions = objects(root.layer_revisions);
  const revisionById = uniqueMap(
    revisions,
    'layer_revision_id',
    errors,
    'PERSISTENCE_REVISION_DUPLICATE',
  );
  const revisionIdentityNumbers = new Set<string>();
  for (const revision of revisions) {
    const identityRevisionKey = `${string(revision.layer_identity_id)}:${String(number(revision.revision_no))}`;
    if (revisionIdentityNumbers.has(identityRevisionKey))
      errors.push('PERSISTENCE_IDENTITY_REVISION_DUPLICATE');
    revisionIdentityNumbers.add(identityRevisionKey);
  }
  const members = objects(root.revision_members);
  const membersByRevision = new Map<string, Obj[]>();
  const memberKeys = new Set<string>();
  for (const member of members) {
    const revisionId = string(member.layer_revision_id);
    const claimId = string(member.memory_claim_id);
    const memberKey = `${revisionId}:${claimId}`;
    if (memberKeys.has(memberKey)) errors.push('PERSISTENCE_MEMBER_CLAIM_DUPLICATE');
    memberKeys.add(memberKey);
    if (!revisionById.has(revisionId)) errors.push('PERSISTENCE_MEMBER_REVISION_UNKNOWN');
    const claim = claimById.get(claimId);
    if (!claim || number(member.claim_revision) !== number(claim.claim_revision))
      errors.push('PERSISTENCE_MEMBER_CLAIM_AUTHORITY_MISMATCH');
    if (claim && string(member.evidence_membership_digest) !== string(claim.evidence_manifest_hash))
      errors.push('PERSISTENCE_MEMBER_EVIDENCE_DIGEST_MISMATCH');
    const rows = membersByRevision.get(revisionId) ?? [];
    rows.push(member);
    membersByRevision.set(revisionId, rows);
  }

  for (const revision of revisions) {
    const revisionId = string(revision.layer_revision_id);
    const identity = identityById.get(string(revision.layer_identity_id));
    const authority = resolutionById.get(string(revision.resolution_id));
    const revisionMembers = membersByRevision.get(revisionId) ?? [];
    if (!identity) errors.push('PERSISTENCE_REVISION_IDENTITY_UNKNOWN');
    if (string(revision.project_id) !== projectId)
      errors.push('PERSISTENCE_REVISION_PROJECT_MISMATCH');
    if (
      identity &&
      (string(identity.project_id) !== string(revision.project_id) ||
        string(identity.origin_session_id) !== string(revision.source_session_id) ||
        string(identity.origin_resolution_id) !== string(revision.resolution_id))
    )
      errors.push('PERSISTENCE_REVISION_IDENTITY_AUTHORITY_MISMATCH');
    if (
      string(revision.layer) === 'mid' &&
      authority &&
      string(revision.source_session_id) !== string(authority.source_session_id)
    )
      errors.push('PERSISTENCE_MID_SESSION_MISMATCH');
    if (!scopeSessionIds.includes(string(revision.source_session_id)))
      errors.push('PERSISTENCE_REVISION_SESSION_OUT_OF_SCOPE');
    if (
      !authority ||
      number(revision.resolution_revision) !== number(authority.resolution_revision) ||
      string(revision.semantic_status) !== string(authority.semantic_status)
    )
      errors.push('PERSISTENCE_REVISION_RESOLUTION_AUTHORITY_MISMATCH');
    if (authority && string(authority.boundary_status) === 'active')
      errors.push('PERSISTENCE_BOUNDARY_MUST_NOT_PROMOTE');
    if (
      number(revision.expected_member_count) !== revisionMembers.length ||
      !contiguous(revisionMembers)
    )
      errors.push('PERSISTENCE_REVISION_MEMBER_PARITY');
    if (
      string(revision.member_manifest_hash) !==
      canonicalDigest(
        revisionMembers.map((member) => [
          member.memory_claim_id,
          member.claim_revision,
          member.role,
          member.input_order,
          member.evidence_membership_digest,
        ]),
      )
    )
      errors.push('PERSISTENCE_REVISION_MANIFEST_MISMATCH');
    const predecessorId = nullableString(revision.predecessor_layer_revision_id);
    if (number(revision.revision_no) === 1 && predecessorId !== null)
      errors.push('PERSISTENCE_FIRST_REVISION_HAS_PREDECESSOR');
    if (number(revision.revision_no) > 1 && predecessorId === null)
      errors.push('PERSISTENCE_PREDECESSOR_REQUIRED');
    if (predecessorId !== null) {
      const predecessor = revisionById.get(predecessorId);
      if (!predecessor) errors.push('PERSISTENCE_PREDECESSOR_UNKNOWN');
      else if (
        string(predecessor.project_id) !== string(revision.project_id) ||
        string(predecessor.layer) !== string(revision.layer) ||
        string(predecessor.layer_identity_id) !== string(revision.layer_identity_id)
      )
        errors.push('PERSISTENCE_PREDECESSOR_SCOPE_MISMATCH');
      else if (number(predecessor.revision_no) + 1 !== number(revision.revision_no))
        errors.push('PERSISTENCE_PREDECESSOR_REVISION_MISMATCH');
    }
  }
  if (hasPredecessorCycle(revisions, revisionById)) errors.push('PERSISTENCE_PREDECESSOR_CYCLE');

  validateMidAndLong(root, revisions, revisionById, scopeSessionIds, errors);
  const jobs = objects(root.jobs);
  const jobById = validateJobs(jobs, policy, errors);
  validatePersistenceReferences(root, checkpoint, revisions, revisionById, jobById, errors);
  validateScopeSessionParity(root, checkpoint, scopeSessionIds, errors);
  validateForeignKeys(objects(root.foreign_keys), errors);
  validateEvidence(root, projectId, scopeSessionIds, errors);
  validateClaimEvidenceMembership(
    claims,
    objects(root.evidence_authorities),
    objects(root.evidence_bridge),
    projectId,
    scopeSessionIds,
    errors,
  );

  const traceAuthorities = objects(root.trace_authorities);
  const traceById = uniqueMap(
    traceAuthorities,
    'trace_id',
    errors,
    'PERSISTENCE_TRACE_AUTHORITY_DUPLICATE',
  );
  for (const trace of traceAuthorities) {
    if (
      string(trace.project_id) !== projectId ||
      !scopeSessionIds.includes(string(trace.session_id))
    )
      errors.push('PERSISTENCE_TRACE_AUTHORITY_SCOPE_MISMATCH');
  }
  for (const retention of objects(root.retention_roots)) {
    if (
      string(retention.policy_revision) !== string(policy.policy_revision) ||
      string(retention.deletion_scope_digest) !== string(policy.deletion_scope_digest)
    )
      errors.push('PERSISTENCE_RETENTION_ROOT_DRIFT');
    if (string(retention.status) !== 'active')
      errors.push('PERSISTENCE_RETENTION_ROOT_NOT_READABLE');
    const targetId = string(retention.target_id);
    const rootKind = string(retention.root_kind);
    if (
      (rootKind === 'checkpoint' && targetId !== string(checkpoint.checkpoint_id)) ||
      (rootKind === 'layer_revision' &&
        !revisions.some((revision) => string(revision.layer_revision_id) === targetId)) ||
      (rootKind === 'job' && !jobById.has(targetId)) ||
      (rootKind === 'trace' && !traceById.has(targetId))
    )
      errors.push('PERSISTENCE_RETENTION_ROOT_TARGET_UNKNOWN');
  }
  const migration = requiredObj(root.migration);
  if (string(migration.mode) === 'upgrade' && string(migration.status) !== 'completed')
    errors.push('PERSISTENCE_UPGRADE_DATA_UNAVAILABLE');
  if (containsBodyKey(root)) errors.push('PERSISTENCE_BODY_KEY_FORBIDDEN');
  return result(errors);
}

export function canonicalDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortJson(value)), 'utf8')
    .digest('hex');
}

function validateMidAndLong(
  root: Obj,
  revisions: Obj[],
  revisionById: ReadonlyMap<string, Obj>,
  scopeSessionIds: string[],
  errors: string[],
): void {
  const manifest = requiredObj(root.mid_manifest);
  const refs = objects(manifest.revisions);
  const midRevisions = revisions.filter((revision) => string(revision.layer) === 'mid');
  const refIds = refs.map((ref) => string(ref.layer_revision_id));
  const midIds = midRevisions.map((revision) => string(revision.layer_revision_id));
  if (
    number(manifest.expected_revision_count) !== refs.length ||
    !contiguous(refs) ||
    !sameOrdered(refIds, midIds)
  )
    errors.push('PERSISTENCE_MID_MANIFEST_REVISION_PARITY');
  if (
    string(manifest.revision_manifest_hash) !==
    canonicalDigest(
      refs.map((ref) => [
        ref.layer_revision_id,
        ref.layer_identity_id,
        ref.resolution_id,
        ref.resolution_revision,
        ref.semantic_status,
        ref.membership_digest,
        ref.input_order,
        ref.source_session_id,
      ]),
    )
  )
    errors.push('PERSISTENCE_MID_MANIFEST_HASH_MISMATCH');
  for (const ref of refs) {
    const revision = revisionById.get(string(ref.layer_revision_id));
    if (
      !revision ||
      string(revision.layer) !== 'mid' ||
      string(ref.layer_identity_id) !== string(revision.layer_identity_id) ||
      string(ref.resolution_id) !== string(revision.resolution_id) ||
      number(ref.resolution_revision) !== number(revision.resolution_revision) ||
      string(ref.semantic_status) !== string(revision.semantic_status) ||
      string(ref.membership_digest) !== string(revision.member_manifest_hash) ||
      string(ref.source_session_id) !== string(revision.source_session_id)
    )
      errors.push('PERSISTENCE_MID_MANIFEST_REFERENCE_MISMATCH');
  }
  const manifestSessions = strings(manifest.source_session_ids);
  const actualSessions = uniqueSorted(refs.map((ref) => string(ref.source_session_id)));
  if (!sameSet(manifestSessions, actualSessions))
    errors.push('PERSISTENCE_MID_SESSION_SET_MISMATCH');
  const longRevisions = revisions.filter((revision) => string(revision.layer) === 'long');
  const projection = obj(root.long_projection);
  if (longRevisions.length > 0 && !projection) errors.push('PERSISTENCE_LONG_PROJECTION_REQUIRED');
  if (longRevisions.length === 0 && projection)
    errors.push('PERSISTENCE_LONG_PROJECTION_WITHOUT_REVISION');
  if (projection) {
    const targetId = string(projection.target_layer_revision_id);
    if (longRevisions.length !== 1 || string(longRevisions[0]?.layer_revision_id) !== targetId)
      errors.push('PERSISTENCE_LONG_REVISION_SET_MISMATCH');
    if (
      !sameSet(strings(projection.source_session_ids), manifestSessions) ||
      !sameSet(strings(projection.source_session_ids), scopeSessionIds)
    )
      errors.push('PERSISTENCE_LONG_SOURCE_SESSION_PARITY');
    if (!sameOrdered(strings(projection.source_mid_revision_ids), refIds))
      errors.push('PERSISTENCE_LONG_MID_REVISION_PARITY');
    if (string(projection.source_mid_manifest_hash) !== string(manifest.revision_manifest_hash))
      errors.push('PERSISTENCE_LONG_MID_MANIFEST_HASH_MISMATCH');
  }
}

function validateJobs(jobs: Obj[], policy: Obj, errors: string[]): Map<string, Obj> {
  const jobById = uniqueMap(jobs, 'job_id', errors, 'PERSISTENCE_JOB_DUPLICATE');
  const winners = new Set<string>();
  for (const job of jobs) {
    if (['pending', 'running', 'succeeded'].includes(string(job.status))) {
      const identity = `${string(job.trigger_identity_hash)}:${string(job.request_identity_hash)}`;
      if (winners.has(identity)) errors.push('PERSISTENCE_TRIGGER_WINNER_DUPLICATE');
      winners.add(identity);
    }
    const retryId = nullableString(job.retry_of_job_id);
    if (retryId !== null && !jobById.has(retryId)) errors.push('PERSISTENCE_JOB_RETRY_UNKNOWN');
    if (retryId !== null) {
      const predecessor = jobById.get(retryId);
      if (predecessor) {
        if (retryId === string(job.job_id)) errors.push('PERSISTENCE_JOB_RETRY_SELF');
        if (!['failed', 'cancelled', 'unavailable'].includes(string(predecessor.status)))
          errors.push('PERSISTENCE_JOB_RETRY_PREDECESSOR_NOT_TERMINAL_RETRYABLE');
        if (
          string(predecessor.trigger_identity_hash) !== string(job.trigger_identity_hash) ||
          string(predecessor.request_identity_hash) !== string(job.request_identity_hash) ||
          string(predecessor.job_type) !== string(job.job_type) ||
          string(predecessor.source_checkpoint_id) !== string(job.source_checkpoint_id) ||
          string(predecessor.target_layer_revision_id) !== string(job.target_layer_revision_id) ||
          string(predecessor.source_revision_digest) !== string(job.source_revision_digest) ||
          string(predecessor.target_revision_digest) !== string(job.target_revision_digest) ||
          number(job.attempt_no) !== number(predecessor.attempt_no) + 1 ||
          string(predecessor.policy_revision) !== string(job.policy_revision)
        )
          errors.push('PERSISTENCE_JOB_RETRY_IDENTITY_MISMATCH');
      }
    }
    if (string(job.policy_revision) !== string(policy.policy_revision))
      errors.push('PERSISTENCE_JOB_POLICY_DRIFT');
  }
  if (hasRetryCycle(jobs, jobById)) errors.push('PERSISTENCE_JOB_RETRY_CYCLE');
  return jobById;
}

function hasRetryCycle(jobs: Obj[], jobById: ReadonlyMap<string, Obj>): boolean {
  for (const job of jobs) {
    const seen = new Set<string>();
    let cursor: Obj | undefined = job;
    while (cursor) {
      const id = string(cursor.job_id);
      if (seen.has(id)) return true;
      seen.add(id);
      const retryId = nullableString(cursor.retry_of_job_id);
      cursor = retryId === null ? undefined : jobById.get(retryId);
    }
  }
  return false;
}

function validatePersistenceReferences(
  root: Obj,
  checkpoint: Obj,
  revisions: Obj[],
  revisionById: ReadonlyMap<string, Obj>,
  jobById: ReadonlyMap<string, Obj>,
  errors: string[],
): void {
  const checkpointId = string(checkpoint.checkpoint_id);
  const checkpointJobId = string(checkpoint.source_p1_final_job_id);
  const checkpointJob = jobById.get(checkpointJobId);
  if (!checkpointJob) errors.push('PERSISTENCE_CHECKPOINT_JOB_UNKNOWN');
  else if (string(checkpointJob.status) !== 'succeeded')
    errors.push('PERSISTENCE_CHECKPOINT_JOB_NOT_SUCCEEDED');
  else if (string(checkpointJob.job_type) !== 'mid_final')
    errors.push('PERSISTENCE_CHECKPOINT_JOB_TYPE_MISMATCH');
  if (checkpointJob && string(checkpointJob.source_checkpoint_id) !== checkpointId)
    errors.push('PERSISTENCE_CHECKPOINT_JOB_CHECKPOINT_MISMATCH');
  if (checkpointJob && !revisionById.has(string(checkpointJob.target_layer_revision_id)))
    errors.push('PERSISTENCE_CHECKPOINT_JOB_TARGET_UNKNOWN');
  if (
    checkpointJob &&
    revisionById.has(string(checkpointJob.target_layer_revision_id)) &&
    string(revisionById.get(string(checkpointJob.target_layer_revision_id))?.layer) !== 'mid'
  )
    errors.push('PERSISTENCE_CHECKPOINT_JOB_TARGET_TYPE_MISMATCH');

  for (const revision of revisions) {
    if (string(revision.source_checkpoint_id) !== checkpointId)
      errors.push('PERSISTENCE_REVISION_CHECKPOINT_MISMATCH');
    const sourceJob = jobById.get(string(revision.source_job_id));
    if (!sourceJob) errors.push('PERSISTENCE_REVISION_JOB_UNKNOWN');
    else if (string(sourceJob.status) !== 'succeeded')
      errors.push('PERSISTENCE_REVISION_JOB_NOT_SUCCEEDED');
    if (
      !sourceJob ||
      string(sourceJob.target_layer_revision_id) !== string(revision.layer_revision_id)
    )
      errors.push('PERSISTENCE_REVISION_JOB_TARGET_MISMATCH');
    if (!sourceJob || string(sourceJob.source_checkpoint_id) !== checkpointId)
      errors.push('PERSISTENCE_REVISION_JOB_CHECKPOINT_MISMATCH');
    if (!revisionById.has(string(revision.layer_revision_id)))
      errors.push('PERSISTENCE_REVISION_REFERENCE_INVALID');
  }
  for (const job of jobById.values()) {
    if (string(job.source_checkpoint_id) !== checkpointId)
      errors.push('PERSISTENCE_JOB_CHECKPOINT_SCOPE_MISMATCH');
  }

  const midManifest = requiredObj(root.mid_manifest);
  const checkpointSourceDigest = string(checkpoint.member_manifest_hash);
  const longSourceDigest = string(midManifest.revision_manifest_hash);
  for (const job of jobById.values()) {
    const target = revisionById.get(string(job.target_layer_revision_id));
    const expectedSourceDigest =
      string(job.job_type) === 'long_session_end' ? longSourceDigest : checkpointSourceDigest;
    if (string(job.source_revision_digest) !== expectedSourceDigest)
      errors.push('PERSISTENCE_JOB_SOURCE_DIGEST_MISMATCH');
    if (!target || string(job.target_revision_digest) !== string(target.member_manifest_hash))
      errors.push('PERSISTENCE_JOB_TARGET_DIGEST_MISMATCH');
  }

  const projection = obj(root.long_projection);
  if (!projection) return;
  const projectionJob = jobById.get(string(projection.job_id));
  if (!projectionJob) errors.push('PERSISTENCE_LONG_JOB_UNKNOWN');
  else if (string(projectionJob.job_type) !== 'long_session_end')
    errors.push('PERSISTENCE_LONG_JOB_TYPE_MISMATCH');
  else if (string(projectionJob.status) !== 'succeeded')
    errors.push('PERSISTENCE_LONG_JOB_NOT_SUCCEEDED');
  const targetRevision = revisionById.get(string(projection.target_layer_revision_id));
  if (!targetRevision) errors.push('PERSISTENCE_LONG_TARGET_REVISION_UNKNOWN');
  else if (string(targetRevision.layer) !== 'long')
    errors.push('PERSISTENCE_LONG_TARGET_REVISION_TYPE_MISMATCH');
  if (
    projectionJob &&
    string(projectionJob.target_layer_revision_id) !== string(projection.target_layer_revision_id)
  )
    errors.push('PERSISTENCE_LONG_JOB_TARGET_REVISION_MISMATCH');
  if (targetRevision && string(targetRevision.source_job_id) !== string(projection.job_id))
    errors.push('PERSISTENCE_LONG_TARGET_SOURCE_JOB_MISMATCH');
  if (
    projectionJob &&
    string(projectionJob.source_checkpoint_id) !== string(checkpoint.checkpoint_id)
  )
    errors.push('PERSISTENCE_LONG_JOB_CHECKPOINT_MISMATCH');
}

function validateScopeSessionParity(
  root: Obj,
  checkpoint: Obj,
  scopeSessionIds: string[],
  errors: string[],
): void {
  const midManifest = requiredObj(root.mid_manifest);
  const midSessions = uniqueSorted(strings(midManifest.source_session_ids));
  const longProjection = obj(root.long_projection);
  const expectedSessions = longProjection
    ? uniqueSorted(strings(longProjection.source_session_ids))
    : midSessions;
  if (!sameSet(scopeSessionIds, expectedSessions))
    errors.push('PERSISTENCE_SCOPE_SESSION_SET_MISMATCH');
  if (!scopeSessionIds.includes(string(checkpoint.source_session_id)))
    errors.push('PERSISTENCE_SCOPE_CHECKPOINT_SESSION_MISSING');
}

function validateForeignKeys(foreignKeys: Obj[], errors: string[]): void {
  const actual = new Map<string, string>();
  for (const foreignKey of foreignKeys) {
    const name = string(foreignKey.name);
    if (actual.has(name)) errors.push('PERSISTENCE_FOREIGN_KEY_DUPLICATE');
    actual.set(
      name,
      `${string(foreignKey.from)}|${string(foreignKey.to)}|${String(foreignKey.nullable)}|${string(foreignKey.on_delete)}`,
    );
  }
  if (
    actual.size !== EXPECTED_FOREIGN_KEYS.size ||
    [...EXPECTED_FOREIGN_KEYS].some(([name, value]) => actual.get(name) !== value)
  )
    errors.push('PERSISTENCE_FOREIGN_KEY_POLICY_MISMATCH');
}

function validateEvidence(
  root: Obj,
  projectId: string,
  sessionIds: string[],
  errors: string[],
): void {
  const authorities = objects(root.evidence_authorities);
  const authorityById = uniqueMap(
    authorities,
    'evidence_id',
    errors,
    'PERSISTENCE_EVIDENCE_AUTHORITY_DUPLICATE',
  );
  for (const authority of authorities) {
    if (
      string(authority.project_id) !== projectId ||
      !sessionIds.includes(string(authority.session_id))
    )
      errors.push('PERSISTENCE_EVIDENCE_AUTHORITY_SCOPE_MISMATCH');
  }
  const bridges = objects(root.evidence_bridge);
  const bridgeById = uniqueMap(
    bridges,
    'evidence_id',
    errors,
    'PERSISTENCE_EVIDENCE_BRIDGE_DUPLICATE',
  );
  for (const authority of authorities) {
    if (!bridgeById.has(string(authority.evidence_id)))
      errors.push('PERSISTENCE_EVIDENCE_BRIDGE_MISSING');
  }
  for (const bridge of bridges) {
    const authority = authorityById.get(string(bridge.evidence_id));
    if (!authority) errors.push('PERSISTENCE_EVIDENCE_AUTHORITY_UNKNOWN');
    else if (
      string(bridge.source_kind) !== string(authority.source_kind) ||
      string(bridge.source_id) !== string(authority.source_id) ||
      number(bridge.source_revision) !== number(authority.source_revision) ||
      string(bridge.membership_digest) !== string(authority.membership_digest) ||
      string(bridge.scope_project_id) !== string(authority.project_id) ||
      string(bridge.scope_session_id) !== string(authority.session_id)
    )
      errors.push('PERSISTENCE_EVIDENCE_AUTHORITY_MISMATCH');
  }
}

function validateClaimEvidenceMembership(
  claims: Obj[],
  authorities: Obj[],
  bridges: Obj[],
  projectId: string,
  sessionIds: string[],
  errors: string[],
): void {
  const authorityById = uniqueMap(
    authorities,
    'evidence_id',
    errors,
    'PERSISTENCE_EVIDENCE_AUTHORITY_DUPLICATE',
  );
  const bridgeById = new Set(bridges.map((bridge) => string(bridge.evidence_id)));
  for (const claim of claims) {
    const claimEvidenceIds = strings(claim.evidence_ids);
    const evidenceRows: Obj[] = [];
    for (const evidenceId of claimEvidenceIds) {
      const authority = authorityById.get(evidenceId);
      if (!authority) {
        errors.push('PERSISTENCE_CLAIM_EVIDENCE_UNKNOWN');
        continue;
      }
      if (
        string(authority.project_id) !== string(claim.project_id) ||
        string(authority.session_id) !== string(claim.source_session_id) ||
        string(authority.project_id) !== projectId ||
        !sessionIds.includes(string(authority.session_id))
      )
        errors.push('PERSISTENCE_CLAIM_EVIDENCE_SCOPE_MISMATCH');
      if (!bridgeById.has(evidenceId)) errors.push('PERSISTENCE_CLAIM_EVIDENCE_BRIDGE_MISSING');
      evidenceRows.push(authority);
    }
    const digest = canonicalDigest(
      evidenceRows
        .sort((left, right) => string(left.evidence_id).localeCompare(string(right.evidence_id)))
        .map((authority) => [
          authority.evidence_id,
          authority.source_kind,
          authority.source_id,
          authority.source_revision,
          authority.membership_digest,
          authority.project_id,
          authority.session_id,
        ]),
    );
    if (string(claim.evidence_manifest_hash) !== digest)
      errors.push('PERSISTENCE_CLAIM_EVIDENCE_MANIFEST_MISMATCH');
  }
}

function schemaValidator(): SchemaValidator {
  if (compiledSchema) return compiledSchema;
  const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
    addFormat(name: string, format: RegExp | ((value: string) => boolean)): void;
    compile(schema: object): SchemaValidator;
  };
  const ajv = new AjvConstructor({ allErrors: true, strict: true, validateFormats: true });
  ajv.addFormat('uuid', UUID);
  ajv.addFormat('date-time', strictUtcDateTime);
  const schema = JSON.parse(
    readFileSync(join(findRoot(), 'docs/contracts/memory-persistence-v1.schema.json'), 'utf8'),
  ) as object;
  compiledSchema = ajv.compile(schema);
  return compiledSchema;
}

function findRoot(): string {
  return process.cwd().replaceAll('\\', '/').endsWith('/apps/api')
    ? join(process.cwd(), '..', '..')
    : process.cwd();
}

function strictUtcDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(value);
  if (!match) return false;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match
    .slice(1, 7)
    .map(Number);
  const millis = Number(match[7] ?? 0);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millis
  );
}

function hasPredecessorCycle(revisions: Obj[], revisionById: ReadonlyMap<string, Obj>): boolean {
  for (const revision of revisions) {
    const seen = new Set<string>();
    let cursor: Obj | undefined = revision;
    while (cursor) {
      const id = string(cursor.layer_revision_id);
      if (seen.has(id)) return true;
      seen.add(id);
      const predecessorId = nullableString(cursor.predecessor_layer_revision_id);
      cursor = predecessorId === null ? undefined : revisionById.get(predecessorId);
    }
  }
  return false;
}

function result(errors: string[]): PersistenceValidationResult {
  return { valid: errors.length === 0, errors: [...new Set(errors)], verification: 'contract' };
}
function obj(value: unknown): Obj | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Obj)
    : null;
}
function requiredObj(value: unknown): Obj {
  return obj(value) ?? {};
}
function objects(value: unknown): Obj[] {
  return Array.isArray(value) ? value.map(obj).filter((item): item is Obj => item !== null) : [];
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
function number(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : -1;
}
function uniqueMap(rows: Obj[], key: string, errors: string[], code: string): Map<string, Obj> {
  const values = new Map<string, Obj>();
  for (const row of rows) {
    const id = string(row[key]);
    if (values.has(id)) errors.push(code);
    else values.set(id, row);
  }
  return values;
}
function uniqueIds(rows: Obj[], key: string, errors: string[], code: string): Set<string> {
  return new Set(uniqueMap(rows, key, errors, code).keys());
}
function contiguous(rows: Obj[]): boolean {
  return rows.every((row, index) => number(row.input_order) === index);
}
function sameOrdered(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameSet(left: string[], right: string[]): boolean {
  return sameOrdered(uniqueSorted(left), uniqueSorted(right));
}
function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
function containsBodyKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsBodyKey);
  const node = obj(value);
  if (!node) return false;
  return Object.entries(node).some(([key, child]) => BODY_KEYS.has(key) || containsBodyKey(child));
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  const node = obj(value);
  if (!node) return value;
  return Object.fromEntries(
    Object.keys(node)
      .sort()
      .map((key) => [key, sortJson(node[key])]),
  );
}
