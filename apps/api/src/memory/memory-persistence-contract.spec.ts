import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  validateMemoryPersistenceManifest,
} from './memory-persistence-contract.js';

const IDS = {
  project: '22222222-2222-4222-8222-222222222222',
  session: '33333333-3333-4333-8333-333333333333',
  checkpoint: '44444444-4444-4444-8444-444444444444',
  job: '55555555-5555-4555-8555-555555555555',
  identity: '66666666-6666-4666-8666-666666666666',
  thread: '77777777-7777-4777-8777-777777777777',
  resolution: '88888888-8888-4888-8888-888888888888',
  revision: '99999999-9999-4999-8999-999999999999',
  claim: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  retention: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  migration: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  evidence: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  source: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  trace: '11111111-1111-4111-8111-111111111111',
} as const;

describe('P2-B memory persistence contract', () => {
  it('accepts the canonical fresh manifest and golden digests', () => {
    const value = baseManifest();
    expect(value.checkpoint.member_manifest_hash).toBe(
      '1b96f51841f223f3711fe987e57b7b1e688c9e2f66559775d680c7a6a94ad6b4',
    );
    expect(value.layer_revisions[0].member_manifest_hash).toBe(
      'e867302db394932a9e451c499abf9eb3acac05ab5ac200f67d06d9c28864b238',
    );
    expect(value.mid_manifest.revision_manifest_hash).toBe(
      'ed9c7cb01d65cf2649b192fa69552b40c52c0c72442d37cf4a620b0dc684df67',
    );
    expect(validateMemoryPersistenceManifest(value)).toEqual({
      valid: true,
      errors: [],
      verification: 'contract',
    });
  });

  it.each([
    ['unknown property', (value: Manifest): Manifest => Object.assign(value, { surprise: true })],
    ['missing required', (value: Manifest): boolean => delete value.checkpoint.immutable_at],
    ['bad uuid format', (value: Manifest): string => (value.scope.project_id = 'bad')],
    ['bad enum', (value: Manifest): string => (value.jobs[0].status = 'done')],
  ])('enforces formal JSON Schema: %s', (_name, mutate) => {
    const value = baseManifest();
    mutate(value);
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(['PERSISTENCE_SCHEMA_INVALID']);
  });

  it('recomputes checkpoint, revision and Mid manifest hashes', () => {
    const value = baseManifest();
    value.checkpoint.member_manifest_hash = '0'.repeat(64);
    value.layer_revisions[0].member_manifest_hash = '1'.repeat(64);
    value.mid_manifest.revision_manifest_hash = '2'.repeat(64);
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(
      expect.arrayContaining([
        'PERSISTENCE_CHECKPOINT_MANIFEST_MISMATCH',
        'PERSISTENCE_REVISION_MANIFEST_MISMATCH',
        'PERSISTENCE_MID_MANIFEST_HASH_MISMATCH',
      ]),
    );
  });

  it('rejects a checkpoint member digest that is rehashed only at the outer manifest', () => {
    const value = baseManifest();
    value.checkpoint_members[0].membership_digest = '0'.repeat(64);
    value.checkpoint.member_manifest_hash = checkpointDigest(value.checkpoint_members);
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(
      expect.arrayContaining([
        'PERSISTENCE_CHECKPOINT_AUTHORITY_MISMATCH',
        'PERSISTENCE_CHECKPOINT_ROOT_IDENTITY_MISMATCH',
        'PERSISTENCE_JOB_SOURCE_DIGEST_MISMATCH',
      ]),
    );
  });

  it('requires Long source sessions and Mid revisions to exactly equal the Mid manifest', () => {
    const value = withLongProjection(baseManifest());
    expect(validateMemoryPersistenceManifest(value).valid).toBe(true);
    const longProjection = value.long_projection;
    expect(longProjection).not.toBeNull();
    if (!longProjection) return;
    longProjection.source_session_ids = ['ffffffff-ffff-4fff-8fff-ffffffffffff'];
    longProjection.source_mid_revision_ids = ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(
      expect.arrayContaining([
        'PERSISTENCE_LONG_SOURCE_SESSION_PARITY',
        'PERSISTENCE_LONG_MID_REVISION_PARITY',
      ]),
    );
  });

  it.each([
    [
      'unknown',
      'PERSISTENCE_PREDECESSOR_UNKNOWN',
      (value: Manifest): void => {
        addSecondRevision(value, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
      },
    ],
    [
      'self',
      'PERSISTENCE_PREDECESSOR_CYCLE',
      (value: Manifest): void => {
        addSecondRevision(
          value,
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
        );
      },
    ],
    [
      'cross identity',
      'PERSISTENCE_PREDECESSOR_SCOPE_MISMATCH',
      (value: Manifest): void => {
        addCrossIdentityRevision(value);
      },
    ],
    [
      'cross layer',
      'PERSISTENCE_PREDECESSOR_SCOPE_MISMATCH',
      (value: Manifest): void => {
        addSecondRevision(value, IDS.revision, undefined, 'long');
      },
    ],
  ])('rejects %s predecessor', (_name, error, mutate) => {
    const value = baseManifest();
    mutate(value);
    expect(validateMemoryPersistenceManifest(value).errors).toContain(error);
  });

  it('rejects an explicit predecessor cycle', () => {
    const value = baseManifest();
    addSecondRevision(value, IDS.revision);
    value.layer_revisions[0].revision_no = 3;
    value.layer_revisions[0].predecessor_layer_revision_id =
      value.layer_revisions[1].layer_revision_id;
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_PREDECESSOR_CYCLE',
    );
  });

  it('rejects a duplicate global identity tuple', () => {
    const value = baseManifest();
    value.layer_identities.push({
      ...value.layer_identities[0],
      layer_identity_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_IDENTITY_TUPLE_DUPLICATE',
    );
  });

  it('requires revision identity origin to match its resolution authority', () => {
    const value = baseManifest();
    value.layer_identities[0].origin_session_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    value.layer_identities[0].identity_key_digest = canonicalDigest([
      value.layer_identities[0].project_id,
      value.layer_identities[0].origin_session_id,
      value.layer_identities[0].origin_thread_id,
      value.layer_identities[0].origin_resolution_id,
    ]);
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_IDENTITY_ORIGIN_AUTHORITY_MISMATCH',
    );
  });

  it('rejects duplicate revision numbers for one layer identity', () => {
    const value = baseManifest();
    addSecondRevision(value, IDS.revision);
    value.layer_revisions[1].layer_revision_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    value.layer_revisions[1].revision_no = 1;
    value.layer_revisions[1].predecessor_layer_revision_id = null;
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_IDENTITY_REVISION_DUPLICATE',
    );
  });

  it('requires checkpoint and Long projection jobs to be real terminal jobs', () => {
    const value = withLongProjection(baseManifest());
    value.checkpoint.source_p1_final_job_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const longProjection = value.long_projection;
    expect(longProjection).not.toBeNull();
    if (!longProjection) return;
    longProjection.job_id = value.jobs[0].job_id;
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(
      expect.arrayContaining([
        'PERSISTENCE_CHECKPOINT_JOB_UNKNOWN',
        'PERSISTENCE_LONG_JOB_TYPE_MISMATCH',
      ]),
    );
  });

  it('requires the checkpoint source field to use the final P1 job type', () => {
    const value = baseManifest();
    value.jobs[0].job_type = 'mid_online';
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_CHECKPOINT_JOB_TYPE_MISMATCH',
    );
  });

  it('binds the checkpoint source job to this checkpoint provenance', () => {
    const value = baseManifest();
    value.jobs[0].source_checkpoint_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_CHECKPOINT_JOB_CHECKPOINT_MISMATCH',
    );
  });

  it('requires scope sessions to equal the exact Mid/Long source set', () => {
    const value = baseManifest();
    value.scope.source_session_ids.push('ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_SCOPE_SESSION_SET_MISMATCH',
    );
  });

  it('keeps retry jobs bound to the same target provenance', () => {
    const value = baseManifest();
    value.jobs.push({
      ...value.jobs[0],
      job_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      status: 'failed',
      attempt_no: 2,
      retry_of_job_id: value.jobs[0].job_id,
      source_revision_digest: 'a'.repeat(64),
    });
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_JOB_RETRY_IDENTITY_MISMATCH',
    );
  });

  it('only retries failed, cancelled or unavailable predecessor jobs', () => {
    const value = baseManifest();
    value.jobs.push({
      ...value.jobs[0],
      job_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      status: 'failed',
      attempt_no: 2,
      retry_of_job_id: value.jobs[0].job_id,
    });
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_JOB_RETRY_PREDECESSOR_NOT_TERMINAL_RETRYABLE',
    );
  });

  it('rejects an orphan Long revision outside the single current target', () => {
    const value = withLongProjection(baseManifest());
    const longTarget = value.layer_revisions.find(({ layer }) => layer === 'long');
    expect(longTarget).toBeDefined();
    if (!longTarget) return;
    value.layer_revisions.push({
      ...longTarget,
      layer_revision_id: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
      revision_no: 2,
      predecessor_layer_revision_id: longTarget.layer_revision_id,
    });
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_LONG_REVISION_SET_MISMATCH',
    );
  });

  it('binds job source and target digests to the checkpoint and revision manifests', () => {
    const value = baseManifest();
    value.jobs[0].source_revision_digest = '0'.repeat(64);
    value.jobs[0].target_revision_digest = '1'.repeat(64);
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(
      expect.arrayContaining([
        'PERSISTENCE_JOB_SOURCE_DIGEST_MISMATCH',
        'PERSISTENCE_JOB_TARGET_DIGEST_MISMATCH',
      ]),
    );
  });

  it('requires trace retention roots to name a known trace authority', () => {
    const value = baseManifest();
    value.retention_roots[0].root_kind = 'trace';
    value.retention_roots[0].target_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_RETENTION_ROOT_TARGET_UNKNOWN',
    );
  });

  it('rejects duplicate claim membership within one revision', () => {
    const value = baseManifest();
    value.revision_members.push({ ...value.revision_members[0], input_order: 1 });
    value.layer_revisions[0].expected_member_count = 2;
    value.layer_revisions[0].member_manifest_hash = revisionDigest(value.revision_members);
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_MEMBER_CLAIM_DUPLICATE',
    );
  });

  it('freezes the exact FK allowlist and SET NULL nullability', () => {
    const value = baseManifest();
    const retentionForeignKey = value.foreign_keys.find(
      ({ name }) => name === 'retention_cleanup_job_fk',
    );
    expect(retentionForeignKey).toBeDefined();
    if (!retentionForeignKey) return;
    retentionForeignKey.nullable = false;
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_FOREIGN_KEY_POLICY_MISMATCH',
    );
  });

  it('binds A1 evidence bridge to the real source authority', () => {
    const value = baseManifest();
    value.evidence_bridge[0].source_revision = 2;
    value.evidence_bridge[0].membership_digest = '0'.repeat(64);
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_EVIDENCE_AUTHORITY_MISMATCH',
    );
  });

  it('binds each Claim to existing evidence authorities and its canonical manifest', () => {
    const value = baseManifest();
    value.claim_authorities[0].evidence_ids = ['ffffffff-ffff-4fff-8fff-ffffffffffff'];
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(
      expect.arrayContaining([
        'PERSISTENCE_CLAIM_EVIDENCE_UNKNOWN',
        'PERSISTENCE_CLAIM_EVIDENCE_MANIFEST_MISMATCH',
      ]),
    );
  });

  it('requires an evidence bridge for every Claim evidence authority', () => {
    const value = baseManifest();
    value.evidence_bridge[0].evidence_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(
      expect.arrayContaining([
        'PERSISTENCE_EVIDENCE_BRIDGE_MISSING',
        'PERSISTENCE_CLAIM_EVIDENCE_BRIDGE_MISSING',
      ]),
    );
  });

  it('requires Claim and Resolution existence, scope and revision parity', () => {
    const value = baseManifest();
    value.claim_authorities[0].project_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    value.layer_revisions[0].resolution_revision = 2;
    value.revision_members[0].claim_revision = 2;
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(
      expect.arrayContaining([
        'PERSISTENCE_CLAIM_SCOPE_MISMATCH',
        'PERSISTENCE_REVISION_RESOLUTION_AUTHORITY_MISMATCH',
        'PERSISTENCE_MEMBER_CLAIM_AUTHORITY_MISMATCH',
      ]),
    );
  });

  it('rejects active Boundary promotion', () => {
    const value = baseManifest();
    value.resolution_authorities[0].boundary_status = 'active';
    expect(validateMemoryPersistenceManifest(value).errors).toContain(
      'PERSISTENCE_BOUNDARY_MUST_NOT_PROMOTE',
    );
  });

  it('rejects copied Long/body fields through the closed schema', () => {
    const value = withLongProjection(baseManifest());
    const longProjection = value.long_projection;
    expect(longProjection).not.toBeNull();
    if (!longProjection) return;
    Object.assign(longProjection, { summary: 'forbidden' });
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(['PERSISTENCE_SCHEMA_INVALID']);
  });

  it('fails closed on policy, retention and interrupted upgrade drift', () => {
    const value = baseManifest();
    value.jobs[0].policy_revision = 'old';
    value.retention_roots[0].status = 'cleanup_failed';
    value.migration.mode = 'upgrade';
    value.migration.status = 'interrupted';
    expect(validateMemoryPersistenceManifest(value).errors).toEqual(
      expect.arrayContaining([
        'PERSISTENCE_JOB_POLICY_DRIFT',
        'PERSISTENCE_RETENTION_ROOT_NOT_READABLE',
        'PERSISTENCE_UPGRADE_DATA_UNAVAILABLE',
      ]),
    );
  });
});

type Manifest = ReturnType<typeof buildBaseManifest>;

function baseManifest(): Manifest {
  return buildBaseManifest();
}

// The inferred fixture shape is intentionally shared by every mutation helper.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildBaseManifest() {
  const evidenceAuthority = {
    evidence_id: IDS.evidence,
    source_kind: 'transcript_segment',
    source_id: IDS.source,
    source_revision: 1,
    membership_digest: '5'.repeat(64),
    project_id: IDS.project,
    session_id: IDS.session,
  };
  const evidenceManifestHash = evidenceDigest([evidenceAuthority]);
  const resolutionMembershipDigest = canonicalDigest([[IDS.claim, 1, evidenceManifestHash]]);
  const checkpointMembers = [
    {
      resolution_id: IDS.resolution,
      resolution_revision: 1,
      semantic_status: 'current',
      claim_count: 1,
      boundary_status: 'none',
      membership_digest: resolutionMembershipDigest,
      input_order: 0,
    },
  ];
  const revisionMembers = [
    {
      layer_revision_id: IDS.revision,
      memory_claim_id: IDS.claim,
      claim_revision: 1,
      role: 'primary',
      input_order: 0,
      evidence_membership_digest: evidenceManifestHash,
    },
  ];
  const midRefs = [
    {
      layer_revision_id: IDS.revision,
      layer_identity_id: IDS.identity,
      resolution_id: IDS.resolution,
      resolution_revision: 1,
      semantic_status: 'current',
      membership_digest: revisionDigest(revisionMembers),
      input_order: 0,
      source_session_id: IDS.session,
    },
  ];
  return {
    contract_version: 'memory-persistence-v1',
    scope: {
      project_id: IDS.project,
      source_session_id: IDS.session,
      source_session_ids: [IDS.session],
    },
    policy: {
      policy_revision: 'p2-1',
      deletion_scope_digest: 'a'.repeat(64),
      deletion_scope_status: 'active',
      retention_policy_version: 'r1',
      retention_status: 'active',
    },
    checkpoint: {
      checkpoint_id: IDS.checkpoint,
      root_identity: checkpointRootDigest({
        checkpoint_id: IDS.checkpoint,
        project_id: IDS.project,
        source_session_id: IDS.session,
        expected_member_count: checkpointMembers.length,
        member_manifest_hash: checkpointDigest(checkpointMembers),
        source_p1_final_job_id: IDS.job,
        policy_revision: 'p2-1',
        retention_policy_version: 'r1',
      }),
      project_id: IDS.project,
      source_session_id: IDS.session,
      expected_member_count: checkpointMembers.length,
      member_manifest_hash: checkpointDigest(checkpointMembers),
      manifest_algorithm_version: 'memory-evolution-canonical-v1',
      source_p1_final_job_id: IDS.job,
      source_p1_final_status: 'succeeded',
      policy_revision: 'p2-1',
      retention_policy_version: 'r1',
      lifecycle_status: 'committed',
      immutable_at: '2026-08-19T00:00:00.000Z',
    },
    checkpoint_members: checkpointMembers,
    claim_authorities: [
      {
        claim_id: IDS.claim,
        claim_revision: 1,
        resolution_id: IDS.resolution,
        project_id: IDS.project,
        source_session_id: IDS.session,
        evidence_ids: [IDS.evidence],
        evidence_manifest_hash: evidenceManifestHash,
      },
    ],
    resolution_authorities: [
      {
        resolution_id: IDS.resolution,
        resolution_revision: 1,
        project_id: IDS.project,
        source_session_id: IDS.session,
        semantic_status: 'current',
        boundary_status: 'none',
        claim_ids: [IDS.claim],
        membership_digest: resolutionMembershipDigest,
      },
    ],
    layer_identities: [
      {
        layer_identity_id: IDS.identity,
        project_id: IDS.project,
        origin_session_id: IDS.session,
        origin_thread_id: IDS.thread,
        origin_resolution_id: IDS.resolution,
        identity_key_digest: canonicalDigest([
          IDS.project,
          IDS.session,
          IDS.thread,
          IDS.resolution,
        ]),
        created_at: '2026-08-19T00:00:00.000Z',
      },
    ],
    layer_revisions: [
      {
        layer_revision_id: IDS.revision,
        layer_identity_id: IDS.identity,
        layer: 'mid',
        revision_no: 1,
        lifecycle_status: 'current',
        project_id: IDS.project,
        source_session_id: IDS.session,
        source_checkpoint_id: IDS.checkpoint,
        source_job_id: IDS.job,
        resolution_id: IDS.resolution,
        resolution_revision: 1,
        semantic_status: 'current',
        predecessor_layer_revision_id: null as string | null,
        expected_member_count: revisionMembers.length,
        member_manifest_hash: revisionDigest(revisionMembers),
        manifest_algorithm_version: 'memory-evolution-canonical-v1',
        created_at: '2026-08-19T00:00:00.000Z',
      },
    ],
    revision_members: revisionMembers,
    mid_manifest: {
      expected_revision_count: midRefs.length,
      revision_manifest_hash: midDigest(midRefs),
      manifest_algorithm_version: 'memory-evolution-canonical-v1',
      source_session_ids: [IDS.session],
      revisions: midRefs,
    },
    long_projection: null as null | {
      job_id: string;
      source_session_ids: string[];
      source_mid_revision_ids: string[];
      source_mid_manifest_hash: string;
    },
    jobs: [
      {
        job_id: IDS.job,
        trigger_identity_hash: '1'.repeat(64),
        job_type: 'mid_final',
        status: 'succeeded',
        attempt_no: 1,
        retry_of_job_id: null as string | null,
        request_identity_hash: '2'.repeat(64),
        policy_revision: 'p2-1',
        source_checkpoint_id: IDS.checkpoint,
        target_layer_revision_id: IDS.revision,
        source_revision_digest: checkpointDigest(checkpointMembers),
        target_revision_digest: revisionDigest(revisionMembers),
      },
    ],
    retention_roots: [
      {
        retention_root_id: IDS.retention,
        root_kind: 'checkpoint',
        target_id: IDS.checkpoint,
        status: 'active',
        expires_at: '2026-12-19T00:00:00.000Z',
        policy_revision: 'p2-1',
        deletion_scope_digest: 'a'.repeat(64),
        cleanup_job_id: null as string | null,
      },
    ],
    migration: {
      schema_version: 'memory-persistence-v1',
      mode: 'fresh',
      manifest_id: IDS.migration,
      source_version: 'none',
      target_version: 'memory-persistence-v1',
      status: 'ready',
    },
    foreign_keys: foreignKeys(),
    evidence_authorities: [evidenceAuthority],
    evidence_bridge: [
      {
        evidence_id: IDS.evidence,
        source_kind: 'transcript_segment',
        source_id: IDS.source,
        source_revision: 1,
        membership_digest: '5'.repeat(64),
        scope_project_id: IDS.project,
        scope_session_id: IDS.session,
      },
    ],
    trace_authorities: [
      {
        trace_id: IDS.trace,
        project_id: IDS.project,
        session_id: IDS.session,
      },
    ],
  };
}

function withLongProjection(value: Manifest): Manifest {
  const longIdentityId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const longThreadId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const longJobId = 'aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaa';
  const longRevisionId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
  value.layer_identities.push({
    ...value.layer_identities[0],
    layer_identity_id: longIdentityId,
    origin_thread_id: longThreadId,
    identity_key_digest: canonicalDigest([IDS.project, IDS.session, longThreadId, IDS.resolution]),
  });
  value.jobs.push({
    ...value.jobs[0],
    job_id: longJobId,
    job_type: 'long_session_end',
    trigger_identity_hash: '8'.repeat(64),
    request_identity_hash: '9'.repeat(64),
    source_checkpoint_id: IDS.checkpoint,
    target_layer_revision_id: longRevisionId,
  });
  const longRevision = {
    ...value.layer_revisions[0],
    layer_revision_id: longRevisionId,
    layer_identity_id: longIdentityId,
    layer: 'long',
    source_job_id: longJobId,
  };
  value.layer_revisions.push(longRevision);
  value.revision_members.push({
    ...value.revision_members[0],
    layer_revision_id: longRevision.layer_revision_id,
  });
  value.long_projection = {
    job_id: longJobId,
    target_layer_revision_id: longRevisionId,
    source_session_ids: [...value.mid_manifest.source_session_ids],
    source_mid_revision_ids: value.mid_manifest.revisions.map(
      ({ layer_revision_id }) => layer_revision_id,
    ),
    source_mid_manifest_hash: value.mid_manifest.revision_manifest_hash,
  };
  const longJob = value.jobs[value.jobs.length - 1];
  if (!longJob) return value;
  longJob.source_revision_digest = value.mid_manifest.revision_manifest_hash;
  const longMember = value.revision_members[value.revision_members.length - 1];
  longJob.target_revision_digest = revisionDigest([...(longMember ? [longMember] : [])]);
  return value;
}

function addSecondRevision(
  value: Manifest,
  predecessorId: string,
  revisionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  layer = 'mid',
): void {
  value.layer_revisions.push({
    ...value.layer_revisions[0],
    layer_revision_id: revisionId,
    layer,
    revision_no: 2,
    predecessor_layer_revision_id: predecessorId,
  });
  value.revision_members.push({ ...value.revision_members[0], layer_revision_id: revisionId });
  if (layer === 'mid') {
    const ref = {
      ...value.mid_manifest.revisions[0],
      layer_revision_id: revisionId,
      input_order: value.mid_manifest.revisions.length,
    };
    value.mid_manifest.revisions.push(ref);
    value.mid_manifest.expected_revision_count = value.mid_manifest.revisions.length;
    value.mid_manifest.revision_manifest_hash = midDigest(value.mid_manifest.revisions);
  }
}

function addCrossIdentityRevision(value: Manifest): void {
  const identity = {
    ...value.layer_identities[0],
    layer_identity_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    origin_thread_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  };
  identity.identity_key_digest = canonicalDigest([
    identity.project_id,
    identity.origin_session_id,
    identity.origin_thread_id,
    identity.origin_resolution_id,
  ]);
  value.layer_identities.push(identity);
  addSecondRevision(value, IDS.revision);
  value.layer_revisions[1].layer_identity_id = identity.layer_identity_id;
  value.mid_manifest.revisions[1].layer_identity_id = identity.layer_identity_id;
  value.mid_manifest.revision_manifest_hash = midDigest(value.mid_manifest.revisions);
}

function checkpointDigest(rows: Array<Record<string, unknown>>): string {
  return canonicalDigest(
    rows.map((row) => [
      row.resolution_id,
      row.resolution_revision,
      row.semantic_status,
      row.claim_count,
      row.boundary_status,
      row.membership_digest,
      row.input_order,
    ]),
  );
}

function checkpointRootDigest(row: Record<string, unknown>): string {
  return canonicalDigest([
    row.checkpoint_id,
    row.project_id,
    row.source_session_id,
    row.expected_member_count,
    row.member_manifest_hash,
    row.source_p1_final_job_id,
    row.policy_revision,
    row.retention_policy_version,
  ]);
}

function revisionDigest(rows: Array<Record<string, unknown>>): string {
  return canonicalDigest(
    rows.map((row) => [
      row.memory_claim_id,
      row.claim_revision,
      row.role,
      row.input_order,
      row.evidence_membership_digest,
    ]),
  );
}

function midDigest(rows: Array<Record<string, unknown>>): string {
  return canonicalDigest(
    rows.map((row) => [
      row.layer_revision_id,
      row.layer_identity_id,
      row.resolution_id,
      row.resolution_revision,
      row.semantic_status,
      row.membership_digest,
      row.input_order,
      row.source_session_id,
    ]),
  );
}

function evidenceDigest(rows: Array<Record<string, unknown>>): string {
  return canonicalDigest(
    [...rows]
      .sort((left, right) => String(left.evidence_id).localeCompare(String(right.evidence_id)))
      .map((row) => [
        row.evidence_id,
        row.source_kind,
        row.source_id,
        row.source_revision,
        row.membership_digest,
        row.project_id,
        row.session_id,
      ]),
  );
}

function foreignKeys(): Array<Record<string, unknown>> {
  return [
    fk('checkpoint_project_fk', 'checkpoint.project_id', 'elder_project.id', false, 'RESTRICT'),
    fk(
      'checkpoint_session_fk',
      'checkpoint.source_session_id',
      'interview_session.id',
      false,
      'RESTRICT',
    ),
    fk(
      'revision_identity_fk',
      'layer_revision.layer_identity_id',
      'layer_identity.layer_identity_id',
      false,
      'RESTRICT',
    ),
    fk(
      'revision_checkpoint_fk',
      'layer_revision.source_checkpoint_id',
      'checkpoint.checkpoint_id',
      false,
      'RESTRICT',
    ),
    fk('revision_job_fk', 'layer_revision.source_job_id', 'ai_job.id', false, 'RESTRICT'),
    fk(
      'revision_resolution_fk',
      'layer_revision.resolution_id',
      'memory_resolution.resolution_id',
      false,
      'RESTRICT',
    ),
    fk(
      'revision_predecessor_fk',
      'layer_revision.predecessor_layer_revision_id',
      'layer_revision.layer_revision_id',
      true,
      'RESTRICT',
    ),
    fk(
      'revision_member_revision_fk',
      'revision_member.layer_revision_id',
      'layer_revision.layer_revision_id',
      false,
      'RESTRICT',
    ),
    fk(
      'revision_member_claim_fk',
      'revision_member.memory_claim_id',
      'memory_claim.claim_id',
      false,
      'RESTRICT',
    ),
    fk(
      'evidence_bridge_authority_fk',
      'evidence_bridge.evidence_id',
      'evidence_authority.evidence_id',
      false,
      'RESTRICT',
    ),
    fk('retention_cleanup_job_fk', 'retention_root.cleanup_job_id', 'ai_job.id', true, 'SET_NULL'),
    fk(
      'job_source_checkpoint_fk',
      'ai_job.source_checkpoint_id',
      'checkpoint.checkpoint_id',
      false,
      'RESTRICT',
    ),
    fk(
      'job_target_revision_fk',
      'ai_job.target_layer_revision_id',
      'layer_revision.layer_revision_id',
      false,
      'RESTRICT',
    ),
    fk(
      'long_projection_target_revision_fk',
      'long_projection.target_layer_revision_id',
      'layer_revision.layer_revision_id',
      false,
      'RESTRICT',
    ),
    fk(
      'retention_target_policy',
      'retention_root.target_id',
      'typed_retention_target.reference',
      false,
      'RESTRICT',
    ),
    fk('trace_authority_fk', 'trace_authority.trace_id', 'decision_trace.id', false, 'RESTRICT'),
  ];
}

function fk(
  name: string,
  from: string,
  to: string,
  nullable: boolean,
  on_delete: string,
): Record<string, unknown> {
  return { name, from, to, nullable, on_delete };
}
