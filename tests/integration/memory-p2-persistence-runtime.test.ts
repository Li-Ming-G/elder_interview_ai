import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiJobCoordinatorService } from '../../apps/api/src/ai-runtime/ai-job-coordinator.service.js';
import { AiOutputEligibilityService } from '../../apps/api/src/ai-runtime/ai-output-eligibility.service.js';
import {
  AiPolicyService,
  LocalTestBoundaryPolicyFixtureReader,
} from '../../apps/api/src/ai-runtime/ai-policy.service.js';
import {
  deletionScopeAuthorityDigest,
  DeletionScopeReader,
  LocalTestDeletionScopeFixtureReader,
  type DeletionScopeSnapshot,
} from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import { canonicalDigest } from '../../apps/api/src/memory/memory-persistence-contract.js';
import {
  EMPTY_MANIFEST_HASH,
  effectiveTextDigest,
  manifestHash,
  sha256,
} from '../../apps/api/src/ai-runtime/ai-provenance.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { Prisma } from '../../apps/api/src/generated/prisma/client.js';
import {
  DeterministicMemoryP2Provider,
  type MemoryP2ProviderPort,
} from '../../apps/api/src/memory/memory-p2-provider.port.js';
import { MemoryP2PersistenceReader } from '../../apps/api/src/memory/memory-p2-persistence.reader.js';
import { MemoryP2PersistenceRepository } from '../../apps/api/src/memory/memory-p2-persistence.repository.js';
import { MemoryP2PlanAdapter } from '../../apps/api/src/memory/memory-p2-plan-adapter.js';
import { MemoryP2RecoveryService } from '../../apps/api/src/memory/memory-p2-recovery.service.js';
import {
  MemoryP2RuntimeFacade,
  MemoryP2RuntimeStoreAdapter,
} from '../../apps/api/src/memory/memory-p2-runtime.js';
import { buildMemoryP2Trigger } from '../../apps/api/src/memory/memory-p2-trigger.js';
import {
  memoryP2CheckpointManifestHash,
  memoryP2LongSourceManifestHash,
  memoryP2SourceSessionSetHash,
  type MemoryP2ClaimInput,
  type MemoryP2CommitInput,
  type MemoryP2FreezeCheckpointInput,
  type MemoryP2LeaseToken,
} from '../../apps/api/src/memory/memory-p2-persistence.types.js';
import {
  semanticContentDigest,
  semanticEvidenceManifestHash,
  semanticSourceManifestHash,
} from '../../apps/api/src/memory/memory-semantic-envelope-contract.js';
import type {
  MemoryP2AnyTriggerRequest,
  MemoryP2MidTriggerKind,
  MemoryP2RunResult,
  MemoryP2SemanticContext,
  MemoryP2SemanticProposal,
} from '../../apps/api/src/memory/memory-p2-runtime.types.js';

describe('MEMORY-T5-T8-P2-C-RUNTIME-001 repository runtime', () => {
  let prisma: PrismaService;
  let repository: MemoryP2PersistenceRepository;
  let reader: MemoryP2PersistenceReader;
  let deletionScopes: LocalTestDeletionScopeFixtureReader;
  let fixture: Awaited<ReturnType<typeof seedFixture>>;
  const integrationFixtures: Array<Awaited<ReturnType<typeof seedFixture>>> = [];

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    prisma = new PrismaService(
      loadApiConfig({
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-p2-retention-pepper',
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-p2-auth-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await prisma.$connect();
    deletionScopes = new LocalTestDeletionScopeFixtureReader();
    repository = new MemoryP2PersistenceRepository(prisma, deletionScopes);
    reader = new MemoryP2PersistenceReader(prisma);
    fixture = await seedFixture(prisma);
  });

  afterAll(async () => {
    try {
      for (const integrationFixture of integrationFixtures)
        await cleanupFixture(prisma, integrationFixture);
      await cleanupFixture(prisma, fixture);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('runs the accepted PostgreSQL binding through Mid, Long wake, replay, and recovery', async () => {
    const onlineFixture = await seedFixture(prisma);
    const finalFixture = await seedFixture(prisma);
    integrationFixtures.push(onlineFixture, finalFixture);
    await prepareRuntimeFixture(prisma, onlineFixture);
    await prepareRuntimeFixture(prisma, finalFixture);
    const sourceManifestHash = await runtimeSourceManifestHash(prisma, onlineFixture);
    const clock = new ManualClock(new Date(Date.now() + 60_000));
    const deletionScopes = new LocalTestDeletionScopeFixtureReader();
    const boundaries = new LocalTestBoundaryPolicyFixtureReader(prisma);
    const policy = new AiPolicyService(prisma, deletionScopes, boundaries);
    const eligibility = new AiOutputEligibilityService(prisma, policy);
    const jobs = new AiJobCoordinatorService(prisma, policy, eligibility);
    const store = new MemoryP2RuntimeStoreAdapter(prisma, jobs, policy, repository, reader, clock);
    const runtime = new MemoryP2RuntimeFacade(
      store,
      new DeterministicNewSlotMemoryP2Provider(),
      new MemoryP2PlanAdapter(),
      clock,
    );

    const online = buildMemoryP2Trigger(
      runtimeTriggerRequest(onlineFixture, sourceManifestHash, 'capacity_checkpoint'),
    );
    const onlineResult = await runtime.run(online);
    const onlineJobId = requireJobId(onlineResult);
    expect(onlineResult).toMatchObject({ outcome: 'succeeded', replayed: false });
    const onlineCounts = await runtimeCounts(prisma, onlineFixture.projectId);
    expect(onlineCounts).toMatchObject({ midJobs: 1, longJobs: 0, revisions: 1 });
    expect(await prisma.decisionTrace.count({ where: { aiJobId: onlineJobId } })).toBe(1);

    const onlineReplay = await runtime.run(online);
    expect(onlineReplay).toMatchObject({ outcome: 'succeeded', replayed: true });
    expect(await runtimeCounts(prisma, onlineFixture.projectId)).toEqual(onlineCounts);

    const finalSourceManifestHash = await runtimeSourceManifestHash(prisma, finalFixture);
    const finalClock = new ManualClock(new Date(Date.now() + 60_000));
    const finalDeletionScopes = new LocalTestDeletionScopeFixtureReader();
    const finalBoundaries = new LocalTestBoundaryPolicyFixtureReader(prisma);
    const finalPolicy = new AiPolicyService(prisma, finalDeletionScopes, finalBoundaries);
    const finalEligibility = new AiOutputEligibilityService(prisma, finalPolicy);
    const finalJobs = new AiJobCoordinatorService(prisma, finalPolicy, finalEligibility);
    const finalStore = new MemoryP2RuntimeStoreAdapter(
      prisma,
      finalJobs,
      finalPolicy,
      repository,
      reader,
      finalClock,
    );
    const finalRuntime = new MemoryP2RuntimeFacade(
      finalStore,
      new DeterministicNewSlotMemoryP2Provider(),
      new MemoryP2PlanAdapter(),
      finalClock,
    );

    const final = buildMemoryP2Trigger(
      runtimeTriggerRequest(finalFixture, finalSourceManifestHash, 'session_final_flush'),
    );
    const finalResult = await finalRuntime.run(final);
    const finalJobId = requireJobId(finalResult);
    expect(finalResult).toMatchObject({ outcome: 'succeeded', followUp: 'registered' });
    const finalProjection = await prisma.memoryP2JobProjection.findUniqueOrThrow({
      where: { aiJobId: finalJobId },
    });
    expect(finalProjection.jobKind).toBe('mid_final');

    const candidate = (await finalRuntime.listPendingLongWakeCandidates()).find(
      (item) => item.sourceMidJobId === finalJobId,
    );
    expect(candidate).toBeDefined();
    if (candidate === undefined) throw new Error('expected pending Long wake candidate');
    const longResult = await finalRuntime.runLongWakeCandidate(candidate);
    const longJobId = requireJobId(longResult);
    expect(longResult).toMatchObject({ outcome: 'succeeded', replayed: false });
    const longProjection = await prisma.memoryLongJobProjection.findUniqueOrThrow({
      where: { aiJobId: longJobId },
    });
    const longJobProjection = await prisma.memoryP2JobProjection.findUniqueOrThrow({
      where: { aiJobId: longJobId },
    });
    expect(longJobProjection.jobKind).toBe('long_session_end');
    expect(longProjection.sourceFinalCheckpointId).toBe(finalProjection.sourceCheckpointId);
    expect(await prisma.memoryLayerRevision.count({ where: { sourceJobId: longJobId } })).toBe(1);
    expect(
      await prisma.memoryLayerRevision.count({
        where: { sourceJobId: longJobId, layer: 'long' },
      }),
    ).toBe(1);
    expect(await prisma.memoryLongJobProjection.count({ where: { aiJobId: onlineJobId } })).toBe(0);

    const stale = buildMemoryP2Trigger(
      runtimeTriggerRequest(finalFixture, finalSourceManifestHash, 'semantic_park'),
    );
    const frozen = await finalStore.freezeJobCheckpointAndRunningTrace(stale);
    expect(frozen.kind).toBe('claimed');
    if (frozen.kind !== 'claimed') throw new Error('expected stale trigger to be claimed');
    const staleJobId = frozen.attempt.jobId;
    const staleProjection = await prisma.memoryP2JobProjection.findUniqueOrThrow({
      where: { aiJobId: staleJobId },
    });
    await prisma.memoryEvolutionCheckpoint.update({
      data: { committedAt: new Date(), lifecycleStatus: 'committed' },
      where: { id: staleProjection.sourceCheckpointId },
    });
    const beforeRecovery = await runtimeCounts(prisma, finalFixture.projectId);
    finalClock.advance(31_000);
    const recovery = await finalRuntime.reconcilePersistedState();
    expect(recovery).toContainEqual({ jobId: staleJobId, outcome: 'terminalized_uncommitted' });
    const afterRecovery = await prisma.aiJob.findUniqueOrThrow({
      where: { id: staleJobId },
    });
    expect(afterRecovery.status).toBe('unavailable');
    expect(await runtimeCounts(prisma, finalFixture.projectId)).toEqual({
      ...beforeRecovery,
      unavailableJobs: beforeRecovery.unavailableJobs + 1,
    });
    expect(await finalRuntime.reconcilePersistedState()).toEqual([]);
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: afterRecovery.id } })).toMatchObject(
      {
        status: 'unavailable',
      },
    );
  });

  it('roundtrips freeze and atomic commit through the fail-closed reader', async () => {
    const frozen = freezeInput(fixture, await createP2Job(prisma, fixture, 'roundtrip'));
    expect(await repository.freezeCheckpoint(frozen)).toEqual({
      checkpointId: frozen.checkpointId,
      replayed: false,
      traceId: frozen.traceId,
    });
    expect(await repository.freezeCheckpoint(frozen)).toEqual({
      checkpointId: frozen.checkpointId,
      replayed: true,
      traceId: frozen.traceId,
    });
    const commit = commitInput(fixture, frozen);
    const result = await repository.commitLayerRevision(commit);
    expect(result).toMatchObject({ checkpointId: frozen.checkpointId, resolutionRevision: 1 });
    expect(result.authorityId).not.toBe(result.resolutionId);
    expect(await reader.readCheckpoint(frozen.checkpointId)).toMatchObject({
      checkpointId: frozen.checkpointId,
      memberIds: [fixture.sourceAuthorityId],
    });
    expect(await reader.readCurrentLayer(result.layerIdentityId)).toMatchObject({
      authorityId: result.authorityId,
      claimIds: result.memoryClaimIds,
      resolutionId: result.resolutionId,
      revisionId: result.layerRevisionId,
      revisionNo: 1,
    });
    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: frozen.aiJobId } });
    const projection = await prisma.memoryP2JobProjection.findUniqueOrThrow({
      where: { aiJobId: frozen.aiJobId },
    });
    expect(job).toMatchObject({ failureCode: null, status: 'succeeded' });
    expect(projection).toMatchObject({
      targetLayerIdentityId: result.layerIdentityId,
      targetLayerRevisionId: result.layerRevisionId,
      targetRevisionDigest: result.targetRevisionDigest,
    });
    expect(await prisma.memoryP2RetentionTarget.count({ where: { aiJobId: frozen.aiJobId } })).toBe(
      4,
    );
  });

  it('rejects a stale deletion-scope digest before semantic mutation', async () => {
    const frozen = freezeInput(fixture, await createP2Job(prisma, fixture, 'stale-deletion'));
    await repository.freezeCheckpoint(frozen);
    const before = await businessCounts(prisma, frozen.aiJobId);
    deletionScopes.setFenceRevision(2);
    try {
      await expect(
        repository.commitLayerRevision(commitInput(fixture, frozen)),
      ).rejects.toMatchObject({
        code: 'MEMORY_P2_JOB_NOT_RUNNING',
      });
      expect(await businessCounts(prisma, frozen.aiJobId)).toEqual(before);
    } finally {
      deletionScopes.setFenceRevision(1);
    }
  });

  it('rejects deletion-scope drift between the authoritative rereads', async () => {
    const raceFixture = await seedFixture(prisma, { suffix: '-deletion-race' });
    integrationFixtures.push(raceFixture);
    const frozen = freezeInput(
      raceFixture,
      await createP2Job(prisma, raceFixture, 'deletion-race'),
    );
    await repository.freezeCheckpoint(frozen);
    const racingReader = new RacyDeletionScopeReader();
    const racingRepository = new MemoryP2PersistenceRepository(prisma, racingReader);
    const before = await businessCounts(prisma, frozen.aiJobId);
    await expect(
      racingRepository.commitLayerRevision(commitInput(raceFixture, frozen)),
    ).rejects.toMatchObject({ code: 'MEMORY_P2_JOB_NOT_RUNNING' });
    expect(racingReader.calls).toBe(2);
    expect(await businessCounts(prisma, frozen.aiJobId)).toEqual(before);
  });

  it('rolls back every semantic and projection write on target CAS mismatch', async () => {
    const existing = await prisma.memoryLayerRevision.findFirstOrThrow({
      where: { lifecycleStatus: 'current', projectId: fixture.projectId },
    });
    const currentResolution = await prisma.memoryResolution.findUniqueOrThrow({
      where: { id: existing.resolutionRowId },
    });
    const identity = await prisma.memoryLayerIdentity.findUniqueOrThrow({
      where: { id: existing.identityId },
    });
    const frozen = freezeInput(fixture, await createP2Job(prisma, fixture, 'cas-loser'));
    await repository.freezeCheckpoint(frozen);
    await prisma.aiJobInputMemory.create({
      data: {
        aiJobId: frozen.aiJobId,
        inputOrder: 0,
        memoryResolutionId: currentResolution.id,
        resolutionRevision: currentResolution.resolutionRevision,
      },
    });
    const commit = commitInput(fixture, frozen, {
      authorityId: currentResolution.authorityId,
      canonicalKey: currentResolution.canonicalKey,
      expectedCurrentResolutionId: currentResolution.id,
      expectedCurrentRevision: currentResolution.resolutionRevision - 1,
      identityId: identity.id,
      identityKeyDigest: identity.identityKeyDigest,
      semanticKind: currentResolution.semanticKind ?? 'fact',
    });
    const before = await businessCounts(prisma, frozen.aiJobId);
    await expect(repository.commitLayerRevision(commit)).rejects.toMatchObject({
      code: 'MEMORY_P2_AUTHORITY_CAS_MISMATCH',
    });
    expect(await businessCounts(prisma, frozen.aiJobId)).toEqual(before);
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: frozen.aiJobId } })).toMatchObject({
      status: 'running',
    });
    expect(
      await prisma.memoryP2JobProjection.findUniqueOrThrow({ where: { aiJobId: frozen.aiJobId } }),
    ).toMatchObject({
      targetLayerIdentityId: null,
      targetLayerRevisionId: null,
      targetRevisionDigest: null,
    });
  });

  it('commits every proposal atomically and exposes the complete multi-target authority', async () => {
    const frozen = freezeInput(fixture, await createP2Job(prisma, fixture, 'multi-target'));
    await repository.freezeCheckpoint(frozen);
    const results = await repository.commitLayerRevisions([
      commitInput(fixture, frozen, { canonicalKey: 'fact:multi-target-a' }),
      commitInput(fixture, frozen, { canonicalKey: 'fact:multi-target-b' }),
    ]);
    expect(results).toHaveLength(2);
    const authority = await repository.readRecoveryAuthority(frozen.aiJobId);
    expect(authority?.committed?.resolutionAuthorityIds).toEqual(
      results.map((result) => result.authorityId).sort(),
    );
    expect(authority?.committed?.evidenceAuthorityIds).toHaveLength(1);
    expect(await prisma.memoryLayerRevision.count({ where: { sourceJobId: frozen.aiJobId } })).toBe(
      2,
    );
  });

  it('rolls back a multi-target commit when the second input loses its target CAS', async () => {
    const rollbackFixture = await seedFixture(prisma);
    integrationFixtures.push(rollbackFixture);
    const frozen = freezeInput(
      rollbackFixture,
      await createP2Job(prisma, rollbackFixture, 'multi-target-rollback'),
    );
    await repository.freezeCheckpoint(frozen);
    const valid = commitInput(rollbackFixture, frozen, {
      canonicalKey: 'fact:multi-target-rollback',
    });
    const invalid = commitInput(rollbackFixture, frozen, {
      canonicalKey: 'fact:multi-target-rollback-invalid',
      expectedCurrentRevision: 1,
    });
    const before = await businessCounts(prisma, frozen.aiJobId);
    const retentionBefore = await prisma.memoryP2RetentionTarget.count({
      where: { aiJobId: frozen.aiJobId },
    });

    await expect(repository.commitLayerRevisions([valid, invalid])).rejects.toMatchObject({
      code: 'MEMORY_P2_AUTHORITY_CAS_MISMATCH',
    });

    expect(await businessCounts(prisma, frozen.aiJobId)).toEqual(before);
    expect(await prisma.memoryLayerRevision.count({ where: { sourceJobId: frozen.aiJobId } })).toBe(
      0,
    );
    expect(await prisma.memoryResolution.count({ where: { aiJobId: frozen.aiJobId } })).toBe(0);
    expect(await prisma.memoryClaim.count({ where: { aiJobId: frozen.aiJobId } })).toBe(0);
    expect(await prisma.memoryP2RetentionTarget.count({ where: { aiJobId: frozen.aiJobId } })).toBe(
      retentionBefore,
    );
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: frozen.aiJobId } })).toMatchObject({
      status: 'running',
      failureCode: null,
    });
    expect(
      await prisma.memoryP2JobProjection.findUniqueOrThrow({ where: { aiJobId: frozen.aiJobId } }),
    ).toMatchObject({
      targetLayerIdentityId: null,
      targetLayerRevisionId: null,
      targetRevisionDigest: null,
    });
    expect(
      await prisma.decisionTrace.findUniqueOrThrow({ where: { id: frozen.traceId } }),
    ).toMatchObject({ status: 'running', errorCode: null });
    expect(
      await prisma.decisionTraceMemorySemantic.findUniqueOrThrow({
        where: { aiJobId: frozen.aiJobId },
      }),
    ).toMatchObject({ commitDigest: null, planDigest: null, proposalDigest: null });
  });

  it('converges a committed multi-target job without duplicating durable authority', async () => {
    const recoveryFixture = await seedFixture(prisma);
    integrationFixtures.push(recoveryFixture);
    const frozen = freezeInput(
      recoveryFixture,
      await createP2Job(prisma, recoveryFixture, 'multi-target-recovery'),
    );
    frozen.sourceTraceReferences = frozen.sourceTraceReferences.map((reference) =>
      reference.sourceKind === 'job'
        ? { ...reference, membershipDigest: sha256(`input:${frozen.aiJobId}`) }
        : reference,
    );
    await repository.freezeCheckpoint(frozen);
    await prisma.aiJobSessionScope.create({
      data: {
        aiJobId: frozen.aiJobId,
        eligibleSegmentCount: 1,
        id: randomUUID(),
        inputOrder: 0,
        maxSegmentId: recoveryFixture.segmentId,
        maxSegmentStartMs: 0,
        scopeReason: 'memory-p2-focused-recovery',
        segmentManifestHash: manifestHash([
          `${String(frozen.inputSegmentId)}:${recoveryFixture.segmentId}:0:1:${recoveryFixture.segmentDigest}`,
        ]),
        sessionId: recoveryFixture.sessionId,
        speakerRoleRevision: 1,
      },
    });
    const results = await repository.commitLayerRevisions([
      commitInput(recoveryFixture, frozen, { canonicalKey: 'fact:multi-target-recovery-a' }),
      commitInput(recoveryFixture, frozen, { canonicalKey: 'fact:multi-target-recovery-b' }),
    ]);
    expect(results).toHaveLength(2);

    const authorityBefore = await repository.readRecoveryAuthority(frozen.aiJobId);
    expect(authorityBefore?.committed).not.toBeNull();
    if (authorityBefore?.committed === null || authorityBefore === null)
      throw new Error('expected committed multi-target recovery authority');
    const committedBefore = authorityBefore.committed;
    const countsBefore = await businessCounts(prisma, frozen.aiJobId);
    const recovery = new MemoryP2RecoveryService(
      {
        applyRecovery: repository.applyRecovery.bind(repository),
        readRecoveryAuthority: repository.readRecoveryAuthority.bind(repository),
        scanCandidateJobIds: repository.scanCandidateJobIds.bind(repository),
        transactionOwnership: 'existing_ai_job_coordinator',
      },
      { record: (): void => undefined },
      { now: (): Date => new Date('2026-08-22T00:00:00.000Z') },
    );

    expect(await recovery.reconcileJob(frozen.aiJobId)).toBe('already_converged');
    expect(await recovery.reconcileJob(frozen.aiJobId)).toBe('already_converged');

    const authorityAfter = await repository.readRecoveryAuthority(frozen.aiJobId);
    expect(authorityAfter?.committed).toEqual(committedBefore);
    expect(authorityAfter?.jobStatus).toBe('succeeded');
    expect(authorityAfter?.trace?.status).toBe('succeeded');
    expect(authorityAfter?.trace?.errorCode).toBeNull();
    expect(
      await prisma.memoryResolutionAuthority.count({
        where: { authorityId: { in: committedBefore.resolutionAuthorityIds } },
      }),
    ).toBe(committedBefore.resolutionAuthorityIds.length);
    expect(
      await prisma.memoryEvidenceAuthority.count({
        where: { evidenceId: { in: committedBefore.evidenceAuthorityIds } },
      }),
    ).toBe(committedBefore.evidenceAuthorityIds.length);
    expect(await prisma.memoryResolution.count({ where: { aiJobId: frozen.aiJobId } })).toBe(2);
    expect(await prisma.memoryClaim.count({ where: { aiJobId: frozen.aiJobId } })).toBe(2);
    expect(await prisma.memoryLayerRevision.count({ where: { sourceJobId: frozen.aiJobId } })).toBe(
      2,
    );
    expect(await businessCounts(prisma, frozen.aiJobId)).toEqual(countsBefore);
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: frozen.aiJobId } })).toMatchObject({
      status: 'succeeded',
      failureCode: null,
    });
  });

  it('returns cas_lost with zero semantic recovery mutation after a durable fence drift', async () => {
    const frozen = freezeInput(fixture, await createP2Job(prisma, fixture, 'recovery-fence'));
    await repository.freezeCheckpoint(frozen);
    await prisma.memoryP2JobProjection.update({
      data: { recoveryLeaseExpiresAt: new Date('2020-01-01T00:00:00.000Z') },
      where: { aiJobId: frozen.aiJobId },
    });
    const before = {
      job: await prisma.aiJob.findUniqueOrThrow({ where: { id: frozen.aiJobId } }),
      projection: await prisma.memoryP2JobProjection.findUniqueOrThrow({
        where: { aiJobId: frozen.aiJobId },
      }),
      semantic: await prisma.decisionTraceMemorySemantic.findUniqueOrThrow({
        where: { aiJobId: frozen.aiJobId },
      }),
      trace: await prisma.decisionTrace.findUniqueOrThrow({ where: { id: frozen.traceId } }),
      counts: await businessCounts(prisma, frozen.aiJobId),
    };
    const recovery = new MemoryP2RecoveryService(
      {
        scanCandidateJobIds: repository.scanCandidateJobIds.bind(repository),
        readRecoveryAuthority: async (
          jobId: string,
        ): Promise<Awaited<ReturnType<MemoryP2PersistenceRepository['readRecoveryAuthority']>>> => {
          const authority = await repository.readRecoveryAuthority(jobId);
          if (authority?.trace === null || authority === null) return authority;
          return {
            ...authority,
            checkpoint:
              authority.checkpoint === null
                ? null
                : {
                    ...authority.checkpoint,
                    deletionScopeDigest: authority.identity.deletionScopeDigest,
                    p2PolicyRevision: authority.p2PolicyRevision,
                    p2RetentionPolicyVersion: authority.p2RetentionPolicyVersion,
                    projectId: authority.identity.projectId,
                    sessionId: authority.identity.sessionId,
                    sourceManifestHash: authority.identity.sourceManifestHash,
                    status: 'committed',
                  },
            legacyNullResolutionCount: 0,
            migrationStatus: 'completed',
            referenceAuthorities: authority.referenceAuthorities.map((reference) => ({
              ...reference,
              projectId: authority.identity.projectId,
              readability: 'active',
              sessionId: authority.sourceSessionIds[0] ?? authority.identity.sessionId,
            })),
            retentionState: 'active',
            trace: {
              ...authority.trace,
              commitDigest: null,
              deletionScopeDigest: authority.identity.deletionScopeDigest,
              errorCode: null,
              memoryOutcome: 'unjudged',
              p2PolicyRevision: authority.p2PolicyRevision,
              p2RetentionPolicyVersion: authority.p2RetentionPolicyVersion,
              planDigest: null,
              proposalDigest: null,
              references: authority.references,
              retentionState: 'active',
              sourceManifestHash: authority.identity.sourceManifestHash,
              stage: 'frozen',
              status: 'running',
            },
          };
        },
        applyRecovery: async (
          command: Parameters<MemoryP2PersistenceRepository['applyRecovery']>[0],
        ): Promise<Awaited<ReturnType<MemoryP2PersistenceRepository['applyRecovery']>>> => {
          await prisma.memoryP2JobProjection.update({
            data: { recoveryLeaseEpoch: command.expectedLeaseEpoch + 1 },
            where: { aiJobId: command.jobId },
          });
          return repository.applyRecovery(command);
        },
        transactionOwnership: 'existing_ai_job_coordinator',
      },
      { record: (): void => undefined },
      { now: (): Date => new Date('2026-08-22T00:00:00.000Z') },
    );
    expect(await recovery.reconcileJob(frozen.aiJobId)).toBe('cas_lost');
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: frozen.aiJobId } })).toEqual(
      before.job,
    );
    expect(
      await prisma.decisionTraceMemorySemantic.findUniqueOrThrow({
        where: { aiJobId: frozen.aiJobId },
      }),
    ).toEqual(before.semantic);
    expect(await prisma.decisionTrace.findUniqueOrThrow({ where: { id: frozen.traceId } })).toEqual(
      before.trace,
    );
    expect(await businessCounts(prisma, frozen.aiJobId)).toEqual(before.counts);
  });

  it('terminalizes unavailable without target IDs or committed Trace digests', async () => {
    const frozen = freezeInput(fixture, await createP2Job(prisma, fixture, 'unavailable'));
    await repository.freezeCheckpoint(frozen);
    await repository.terminalizeUnavailable({
      aiJobId: frozen.aiJobId,
      errorCode: 'P2_PROVIDER_UNAVAILABLE',
      lease: frozen.lease,
      traceId: frozen.traceId,
    });
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: frozen.aiJobId } })).toMatchObject({
      failureCode: 'P2_PROVIDER_UNAVAILABLE',
      status: 'unavailable',
    });
    expect(
      await prisma.memoryP2JobProjection.findUniqueOrThrow({ where: { aiJobId: frozen.aiJobId } }),
    ).toMatchObject({
      targetLayerIdentityId: null,
      targetLayerRevisionId: null,
      targetRevisionDigest: null,
      terminalErrorCode: 'P2_PROVIDER_UNAVAILABLE',
    });
    expect(
      await prisma.decisionTraceMemorySemantic.findUniqueOrThrow({
        where: { traceId: frozen.traceId },
      }),
    ).toMatchObject({
      commitDigest: null,
      planDigest: null,
      proposalDigest: null,
    });
  });

  it('uses an expiring durable lease so two recovery scanners have one winner and fence the late worker', async () => {
    const frozen = freezeInput(fixture, await createP2Job(prisma, fixture, 'lease-recovery'));
    await repository.freezeCheckpoint(frozen);
    expect(
      (await repository.listStaleRecoveryCandidates()).some(
        (candidate) => candidate.aiJobId === frozen.aiJobId,
      ),
    ).toBe(false);
    const expiredAt = new Date('2020-01-01T00:00:00.000Z');
    await prisma.memoryP2JobProjection.update({
      data: { recoveryLeaseExpiresAt: expiredAt },
      where: { aiJobId: frozen.aiJobId },
    });
    const stale = await repository.listStaleRecoveryCandidates();
    expect(stale).toContainEqual({
      aiJobId: frozen.aiJobId,
      lease: { ...frozen.lease, expiresAt: expiredAt },
    });
    const claim = {
      aiJobId: frozen.aiJobId,
      expectedEpoch: frozen.lease.epoch,
      leaseExpiresAt: new Date('2029-06-01T00:00:00.000Z'),
    };
    const [left, right] = await Promise.all([
      repository.claimRecoveryLease({ ...claim, leaseOwner: 'scanner-left' }),
      repository.claimRecoveryLease({ ...claim, leaseOwner: 'scanner-right' }),
    ]);
    const winners = [left, right].filter((lease) => lease !== null);
    expect(winners).toHaveLength(1);
    const winner = winners[0];
    expect(winner).toMatchObject({ epoch: 2 });
    if (winner === undefined) throw new Error('expected one recovery lease winner');
    const before = await businessCounts(prisma, frozen.aiJobId);
    await expect(
      repository.commitLayerRevision(commitInput(fixture, frozen)),
    ).rejects.toMatchObject({ code: 'MEMORY_P2_JOB_NOT_RUNNING' });
    expect(await businessCounts(prisma, frozen.aiJobId)).toEqual(before);
    await repository.terminalizeUnavailable({
      aiJobId: frozen.aiJobId,
      errorCode: 'P2_STALE_RECOVERY',
      lease: winner,
      traceId: frozen.traceId,
    });
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: frozen.aiJobId } })).toMatchObject({
      failureCode: 'P2_STALE_RECOVERY',
      status: 'unavailable',
    });
  });

  it('freezes Long without a second checkpoint and commits its complete Mid source projection', async () => {
    const finalJob = await createP2Job(prisma, fixture, 'final-mid', 'mid_final');
    const finalFreeze = freezeFinalInput(fixture, finalJob);
    await repository.freezeCheckpoint(finalFreeze);
    const finalResult = await repository.commitLayerRevision(
      commitInput(fixture, finalFreeze, { canonicalKey: 'fact:final-mid' }),
    );
    const finalRevision = await prisma.memoryLayerRevision.findUniqueOrThrow({
      where: { id: finalResult.layerRevisionId },
    });
    const finalResolution = await prisma.memoryResolution.findUniqueOrThrow({
      where: { id: finalResult.resolutionId },
    });
    const identity = await prisma.memoryLayerIdentity.findUniqueOrThrow({
      where: { id: finalResult.layerIdentityId },
    });
    const restartedReader = new MemoryP2PersistenceReader(prisma);
    const firstWakeScan = await restartedReader.listPendingLongWakeCandidates();
    const secondWakeScan = await restartedReader.listPendingLongWakeCandidates();
    expect(firstWakeScan).toEqual(secondWakeScan);
    const fixtureWakes = firstWakeScan.filter(
      (candidate) => candidate.projectId === fixture.projectId,
    );
    expect(fixtureWakes).toHaveLength(1);
    const fixtureWake = fixtureWakes[0];
    expect(fixtureWake).toMatchObject({
      sourceFinalMidCheckpointId: finalFreeze.checkpointId,
      sourceMidJobId: finalJob.id,
      sourceP1TerminalJobId: fixture.p1JobId,
      sourceRevisionDigest: finalRevision.memberManifestHash,
      sourceSessionId: fixture.sessionId,
    });
    if (fixtureWake === undefined) throw new Error('expected a durable Long wake candidate');
    const longJob = await createP2Job(
      prisma,
      fixture,
      'long',
      'long_session_end',
      fixtureWake.triggerDedupeKey,
    );
    await prisma.aiJobInputMemory.create({
      data: {
        aiJobId: longJob.id,
        inputOrder: 0,
        memoryResolutionId: finalResolution.id,
        resolutionRevision: finalResolution.resolutionRevision,
      },
    });
    const longTraceId = randomUUID();
    const longScopeDigest = deletionScopeAuthorityDigest(fixture.projectId, [fixture.sessionId], 1);
    const checkpointCount = await prisma.memoryEvolutionCheckpoint.count();
    const longLease = leaseFor(longJob.id);
    const longFreezeInput = {
      aiJobId: longJob.id,
      deletionScopeDigest: longScopeDigest,
      deletionScopePolicyRevision: 1,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      lease: longLease,
      ownerActorId: fixture.actorId,
      p2PolicyContractRevision: 'memory-p2-policy-contract-v1',
      p2PolicyRevision: 'memory-p2-policy-v1',
      p2RetentionContractVersion: 'memory-p2-retention-contract-v1',
      p2RetentionPolicyVersion: 'memory-p2-retention-v1',
      projectId: fixture.projectId,
      sourceFinalMidCheckpointId: finalFreeze.checkpointId,
      sourceP1TerminalJobId: fixture.p1JobId,
      sourceRevisionDigest: finalRevision.memberManifestHash,
      sourceSessionId: fixture.sessionId,
      sourceTraceReferences: [
        {
          deletionScopeDigest: longScopeDigest,
          inputOrder: 0,
          membershipDigest: finalRevision.memberManifestHash,
          sourceId: finalFreeze.checkpointId,
          sourceKind: 'checkpoint',
          sourceRevision: 1,
        },
        {
          deletionScopeDigest: longScopeDigest,
          inputOrder: 1,
          membershipDigest: sha256(`job:${longJob.id}`),
          sourceId: longJob.id,
          sourceKind: 'job',
          sourceRevision: 1,
        },
        {
          deletionScopeDigest: longScopeDigest,
          inputOrder: 2,
          membershipDigest: fixture.segmentDigest,
          sourceId: longJob.inputSegmentId,
          sourceKind: 'input_segment',
          sourceRevision: 0,
        },
      ],
      targetSlotDigest: sha256(finalResolution.canonicalKey),
      traceGenerationId: randomUUID(),
      traceId: longTraceId,
      traceRequestId: randomUUID(),
      triggerIdentityHash: sha256(`memory-p2-v1:${fixture.sessionId}:long`),
    } as const;
    expect(await repository.freezeLongJob(longFreezeInput)).toMatchObject({ replayed: false });
    expect(await repository.freezeLongJob(longFreezeInput)).toMatchObject({ replayed: true });
    expect(
      (await restartedReader.listPendingLongWakeCandidates()).filter(
        (candidate) => candidate.projectId === fixture.projectId,
      ),
    ).toEqual([]);
    expect(await prisma.memoryEvolutionCheckpoint.count()).toBe(checkpointCount);
    const secondFixture = await seedFixture(prisma, {
      actorId: fixture.actorId,
      projectId: fixture.projectId,
      sequenceNo: 2,
      suffix: '-second',
    });
    const secondFinalJob = await createP2Job(prisma, secondFixture, 'final-mid', 'mid_final');
    const secondFinalFreeze = freezeFinalInput(
      secondFixture,
      secondFinalJob,
      'fact:final-mid-second',
    );
    await repository.freezeCheckpoint(secondFinalFreeze);
    const secondFinalResult = await repository.commitLayerRevision(
      commitInput(secondFixture, secondFinalFreeze, { canonicalKey: 'fact:final-mid-second' }),
    );
    const secondFinalRevision = await prisma.memoryLayerRevision.findUniqueOrThrow({
      where: { id: secondFinalResult.layerRevisionId },
    });
    await prisma.aiJobInputMemory.create({
      data: {
        aiJobId: longJob.id,
        inputOrder: 1,
        memoryResolutionId: secondFinalResult.resolutionId,
        resolutionRevision: secondFinalResult.resolutionRevision,
      },
    });
    const checkpointSource = finalFreeze.sourceTraceReferences[0];
    const jobSource = finalFreeze.sourceTraceReferences[1];
    const segmentSource = finalFreeze.sourceTraceReferences[2];
    if (checkpointSource === undefined || jobSource === undefined || segmentSource === undefined)
      throw new Error('expected complete frozen Trace sources');
    const base = commitInput(
      fixture,
      {
        ...finalFreeze,
        aiJobId: longJob.id,
        checkpointId: finalFreeze.checkpointId,
        lease: longLease,
        sourceTraceReferences: [
          checkpointSource,
          jobSource,
          { ...segmentSource, sourceId: longJob.inputSegmentId },
        ],
        traceId: longTraceId,
      },
      {
        authorityId: finalResult.authorityId,
        canonicalKey: finalResolution.canonicalKey,
        expectedCurrentResolutionId: finalResolution.id,
        expectedCurrentRevision: finalResolution.resolutionRevision,
        identityId: identity.id,
        identityKeyDigest: identity.identityKeyDigest,
        semanticKind: finalResolution.semanticKind ?? 'fact',
      },
    );
    const longSources = [
      {
        inputOrder: 0,
        membershipDigest: finalRevision.memberManifestHash,
        sourceMidRevisionId: finalRevision.id,
        sourceSessionId: fixture.sessionId,
      },
      {
        inputOrder: 1,
        membershipDigest: secondFinalRevision.memberManifestHash,
        sourceMidRevisionId: secondFinalRevision.id,
        sourceSessionId: secondFixture.sessionId,
      },
    ];
    const longResult = await repository.commitLayerRevision({
      ...base,
      longSourceManifestHash: sha256(`long-source:${longJob.id}`),
      longSourceMidManifestHash: memoryP2LongSourceManifestHash(longSources),
      longSources,
      target: { ...base.target, layer: 'long' },
    });
    expect(
      await prisma.memoryLongJobProjection.findUnique({ where: { aiJobId: longJob.id } }),
    ).toMatchObject({
      expectedSourceCount: 2,
      sourceSessionIds: [fixture.sessionId, secondFixture.sessionId].sort(),
      sourceSessionSetHash: memoryP2SourceSessionSetHash([
        fixture.sessionId,
        secondFixture.sessionId,
      ]),
      sourceFinalCheckpointId: finalFreeze.checkpointId,
      targetLayerRevisionId: longResult.layerRevisionId,
    });
    expect(await reader.readCurrentLayer(identity.id)).toMatchObject({
      layer: 'long',
      revisionId: longResult.layerRevisionId,
      revisionNo: 2,
    });
    const longProjection = await prisma.memoryLongJobProjection.findUniqueOrThrow({
      where: { aiJobId: longJob.id },
    });
    await expect(
      prisma.memoryLongJobProjection.update({
        data: { sourceSessionIds: [fixture.sessionId, fixture.sessionId] },
        where: { id: longProjection.id },
      }),
    ).rejects.toThrow(/P2_REFERENCE_ROWS_ARE_APPEND_ONLY/);
    expect(await reader.readCurrentLayer(identity.id)).not.toBeNull();
  });
});

async function seedFixture(
  prisma: PrismaService,
  options?: { actorId: string; projectId: string; sequenceNo: number; suffix: string },
): Promise<RuntimeFixture> {
  const actorId = options?.actorId ?? randomUUID();
  const projectId = options?.projectId ?? randomUUID();
  const suffix = options?.suffix ?? '';
  const sessionId = randomUUID();
  const streamId = randomUUID();
  const segmentId = randomUUID();
  const threadId = randomUUID();
  const threadRevisionId = randomUUID();
  const sourceClaimId = randomUUID();
  const sourceResolutionId = randomUUID();
  const sourceAuthorityId = randomUUID();
  const retentionRootId = randomUUID();
  const p1JobId = randomUUID();
  const snapshotId = randomUUID();
  const text = `工作记忆[fact:source-school${suffix}]=虚构的校园记忆证据${suffix}`;
  if (options === undefined)
    await prisma.user.create({
      data: {
        displayName: 'Fictional P2 persistence actor',
        email: `p2-${actorId}@example.test`,
        id: actorId,
        passwordHash: 'test-only',
        role: 'interviewer',
      },
    });
  if (options === undefined)
    await prisma.elderProject.create({
      data: {
        aiPolicyRevision: 1,
        aiRetentionPolicyVersion: 1,
        createdBy: actorId,
        displayName: 'Fictional P2 project',
        id: projectId,
      },
    });
  await prisma.interviewSession.create({
    data: {
      createdBy: actorId,
      id: sessionId,
      projectId,
      sequenceNo: options?.sequenceNo ?? 1,
      speakerRoleRevision: 1,
      status: 'completed',
    },
  });
  await prisma.speakerStream.create({
    data: { closedAt: new Date(), id: streamId, sessionId, status: 'closed' },
  });
  await prisma.transcriptSegment.create({
    data: {
      contentKind: 'conversation',
      endMs: 900,
      id: segmentId,
      ingestKey: `p2-${segmentId}`,
      originalRoleAuthority: 'user_confirmed',
      originalSpeakerRole: 'elder',
      originalText: text,
      sessionId,
      source: 'fixture',
      speakerRoleRevision: 1,
      speakerStreamId: streamId,
      startMs: 0,
      textRevision: 0,
    },
  });
  await prisma.memoryThread.create({
    data: { id: threadId, originSessionId: sessionId, projectId },
  });
  await prisma.memoryThreadRevision.create({
    data: {
      id: threadRevisionId,
      revision: 1,
      sourceSessionId: sessionId,
      status: 'active',
      threadId,
      topicKey: `school${suffix}`,
    },
  });
  await prisma.memoryRetentionRoot.create({
    data: {
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      id: retentionRootId,
      projectId,
      retentionPolicyVersion: 1,
      sourceKind: 'system_migration',
      sourceOperationId: randomUUID(),
    },
  });
  await prisma.memoryResolutionAuthority.create({
    data: {
      authorityId: sourceAuthorityId,
      canonicalKey: `fact:source-school${suffix}`,
      originSessionId: sessionId,
      originThreadId: threadId,
      projectId,
      semanticKind: 'fact',
    },
  });
  await prisma.memoryClaim.create({
    data: {
      canonicalKey: `fact:source-school${suffix}`,
      explicitCorrection: false,
      id: sourceClaimId,
      layer: 'working',
      memoryRetentionRootId: retentionRootId,
      normalizedValueDigest: sha256(JSON.stringify({ value: 'source' })),
      projectId,
      provenanceState: 'active',
      semanticKind: 'fact',
      sourceSessionId: sessionId,
      threadId,
      valueJson: { value: 'source' },
      valueKind: 'exact',
      authority: 'system_migration',
    },
  });
  await prisma.memoryResolution.create({
    data: {
      authority: 'system_migration',
      authorityId: sourceAuthorityId,
      canonicalKey: `fact:source-school${suffix}`,
      id: sourceResolutionId,
      layer: 'working',
      memoryRetentionRootId: retentionRootId,
      projectId,
      provenanceState: 'active',
      resolutionKind: 'single',
      resolutionRevision: 1,
      resolvedValueJson: { value: 'source' },
      semanticKind: 'fact',
      semanticStatus: 'current',
      sourceSessionId: sessionId,
      status: 'current',
      threadId,
    },
  });
  await prisma.memoryResolutionMember.create({
    data: {
      memberOrder: 0,
      memoryClaimId: sourceClaimId,
      memoryResolutionId: sourceResolutionId,
    },
  });
  await prisma.aiJob.create({
    data: aiJobData({
      actorId,
      id: p1JobId,
      jobType: 'working_memory_maintain',
      projectId,
      status: 'succeeded',
      triggerDedupeKey: `memory-p1-v1.2:${sessionId}:final`,
    }),
  });
  await prisma.memoryWorkingSnapshot.create({
    data: {
      aiJobId: p1JobId,
      boundaryManifestHash: manifestHash([]),
      contractVersion: 'memory-maintainer-v1.2',
      expectedBoundaryCount: 0,
      expectedResolutionCount: 1,
      expectedThreadCount: 1,
      id: snapshotId,
      policyRevision: 1,
      projectId,
      resolutionManifestHash: manifestHash([`${sourceResolutionId}:1:current:${threadId}`]),
      sourceSessionId: sessionId,
      threadManifestHash: manifestHash([`${threadId}:1:active`]),
      triggerIdentity: `memory-p1-v1.2:${sessionId}:snapshot`,
      triggerKind: 'session_final_flush',
    },
  });
  await prisma.memoryWorkingSnapshotResolution.create({
    data: {
      inputOrder: 0,
      membershipDigest: '1'.repeat(64),
      memoryResolutionId: sourceResolutionId,
      resolutionRevision: 1,
      snapshotId,
    },
  });
  await prisma.memoryWorkingSnapshotThread.create({
    data: {
      inputOrder: 0,
      membershipDigest: '2'.repeat(64),
      revision: 1,
      snapshotId,
      threadId,
      threadRevisionId,
    },
  });
  return {
    actorId,
    p1JobId,
    projectId,
    segmentDigest: effectiveTextDigest(text),
    segmentId,
    sessionId,
    snapshotId,
    sourceAuthorityId,
    sourceClaimId,
    sourceResolutionId,
    streamId,
    threadId,
    threadRevisionId,
  };
}

async function createP2Job(
  prisma: PrismaService,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  suffix: string,
  jobType: 'long_session_end' | 'mid_final' | 'mid_online' = 'mid_online',
  triggerDedupeKey = `memory-p2-v1:${fixture.sessionId}:${suffix}`,
): Promise<{ id: string; inputSegmentId: string; suffix: string }> {
  const id = randomUUID();
  await prisma.aiJob.create({
    data: aiJobData({
      actorId: fixture.actorId,
      id,
      jobType,
      projectId: fixture.projectId,
      status: 'running',
      triggerDedupeKey,
    }),
  });
  const inputSegmentId = randomUUID();
  await prisma.aiJobInputSegment.create({
    data: {
      aiJobId: id,
      contentKind: 'conversation',
      effectiveTextDigest: fixture.segmentDigest,
      id: inputSegmentId,
      inputOrder: 0,
      roleAuthority: 'user_confirmed',
      sessionId: fixture.sessionId,
      speakerRoleRevision: 1,
      textRevision: 0,
      transcriptSegmentId: fixture.segmentId,
      trustedEffectiveRole: 'elder',
    },
  });
  return { id, inputSegmentId, suffix };
}

function freezeFinalInput(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  job: Awaited<ReturnType<typeof createP2Job>>,
  canonicalKey = 'fact:final-mid',
): MemoryP2FreezeCheckpointInput {
  const online = freezeInput(fixture, job);
  return {
    ...online,
    sourceCurrentExpectedCount: 1,
    sourceCurrentManifestHash: online.sourceResolutionManifestHash,
    sourceP1TerminalJobId: fixture.p1JobId,
    sourceP1TerminalOutcome: 'snapshot_committed',
    sourceP1TerminalStatus: 'succeeded',
    sourceSetKind: 'final_mid_and_current',
    targetSlotDigest: sha256(canonicalKey),
    triggerKind: 'session_final_flush',
  };
}

function freezeInput(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  job: Awaited<ReturnType<typeof createP2Job>>,
): MemoryP2FreezeCheckpointInput {
  const member = {
    boundaryStatus: 'none',
    claimCount: 1,
    inputOrder: 0,
    membershipDigest: canonicalDigest([fixture.sourceClaimId, 1, 'source-evidence-manifest']),
    resolutionAuthorityId: fixture.sourceAuthorityId,
    resolutionRevision: 1,
    resolutionRowId: fixture.sourceResolutionId,
    semanticStatus: 'current' as const,
  };
  const checkpointId = randomUUID();
  const traceId = randomUUID();
  const deletionScopeDigest = deletionScopeAuthorityDigest(
    fixture.projectId,
    [fixture.sessionId],
    1,
  );
  const memberManifestHash = memoryP2CheckpointManifestHash([member]);
  return {
    aiJobId: job.id,
    aiPolicyRevision: 1,
    checkpointId,
    deletionScopeDigest,
    deletionScopePolicyRevision: 1,
    evidenceManifestHash: sha256(`evidence:${job.id}`),
    expectedMemberCount: 1,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    lease: leaseFor(job.id),
    memberManifestHash,
    members: [member],
    midExpectedCount: 0,
    midManifestHash: null,
    ownerActorId: fixture.actorId,
    p2PolicyContractRevision: 'memory-p2-policy-contract-v1',
    p2PolicyRevision: 'memory-p2-policy-v1',
    p2RetentionContractVersion: 'memory-p2-retention-contract-v1',
    p2RetentionPolicyVersion: 'memory-p2-retention-v1',
    projectId: fixture.projectId,
    retentionPolicyVersion: 1,
    rootIdentity: sha256(`root:${job.id}`),
    sourceBoundaryManifestHash: manifestHash([]),
    sourceCurrentExpectedCount: 0,
    sourceCurrentManifestHash: null,
    sourceP1TerminalJobId: null,
    sourceP1TerminalOutcome: null,
    sourceP1TerminalStatus: null,
    sourceResolutionManifestHash: manifestHash([`${fixture.sourceAuthorityId}:1:current`]),
    sourceRevisionDigest: memberManifestHash,
    sourceSessionId: fixture.sessionId,
    sourceSetKind: 'working_checkpoint',
    sourceThreadId: fixture.threadId,
    sourceThreadManifestHash: manifestHash([`${fixture.threadId}:1:active`]),
    sourceThreadRevision: 1,
    sourceThreadRevisionId: fixture.threadRevisionId,
    sourceThreadStatus: 'active',
    sourceTraceReferences: [
      {
        deletionScopeDigest,
        inputOrder: 0,
        membershipDigest: memberManifestHash,
        sourceId: checkpointId,
        sourceKind: 'checkpoint',
        sourceRevision: 1,
      },
      {
        deletionScopeDigest,
        inputOrder: 1,
        membershipDigest: sha256(`job:${job.id}`),
        sourceId: job.id,
        sourceKind: 'job',
        sourceRevision: 1,
      },
      {
        deletionScopeDigest,
        inputOrder: 2,
        membershipDigest: fixture.segmentDigest,
        sourceId: job.inputSegmentId,
        sourceKind: 'input_segment',
        sourceRevision: 0,
      },
    ],
    sourceWorkingSnapshotContractVersion: 'memory-maintainer-v1.2',
    sourceWorkingSnapshotId: fixture.snapshotId,
    targetSlotDigest: sha256('fact:target-school'),
    traceGenerationId: randomUUID(),
    traceId,
    traceRequestId: randomUUID(),
    triggerIdentity: `memory-p2-v1:${fixture.sessionId}:${job.suffix}`,
    triggerIdentityHash: sha256(`memory-p2-v1:${fixture.sessionId}:${job.suffix}`),
    triggerKind: 'capacity_checkpoint',
  };
}

function commitInput(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  frozen: MemoryP2FreezeCheckpointInput,
  existing?: Partial<MemoryP2CommitInput['target']>,
): MemoryP2CommitInput {
  const evidence = {
    authorityRevision: 1 as const,
    effectiveTextDigest: fixture.segmentDigest,
    expectedEvidenceId: null,
    inputOrder: 0,
    inputSegmentId: frozen.sourceTraceReferences[2]?.sourceId ?? '',
    membershipDigest: sha256(`membership:${fixture.segmentId}`),
    sourceId: fixture.segmentId,
    speakerRoleRevision: 1,
    textRevision: 0,
  };
  const canonicalKey = existing?.canonicalKey ?? 'fact:target-school';
  const claim: MemoryP2ClaimInput = {
    canonicalKey,
    evidences: [evidence],
    explicitCorrection: false,
    memoryType: null,
    normalizedValueDigest: sha256(JSON.stringify({ value: 'new semantic memory' })),
    role: 'primary',
    semanticKind: existing?.semanticKind ?? 'fact',
    valueJson: { value: 'new semantic memory' },
    valueKind: 'exact',
  };
  const authorityId = existing?.authorityId ?? null;
  const identityKeyDigest =
    existing?.identityKeyDigest ??
    canonicalDigest([
      fixture.projectId,
      fixture.sessionId,
      fixture.threadId,
      authorityId ?? canonicalKey,
    ]);
  return {
    aiJobId: frozen.aiJobId,
    checkpointId: frozen.checkpointId,
    claims: [claim],
    commitDigest: sha256(`commit:${frozen.aiJobId}`),
    deletionScopeDigest: frozen.deletionScopeDigest,
    longSourceMidManifestHash: null,
    longSourceManifestHash: null,
    longSources: [],
    lease: frozen.lease,
    planDigest: sha256(`plan:${frozen.aiJobId}`),
    projectId: fixture.projectId,
    proposalDigest: sha256(`proposal:${frozen.aiJobId}`),
    sourceSessionId: fixture.sessionId,
    target: {
      authorityId,
      canonicalKey,
      expectedCurrentResolutionId: existing?.expectedCurrentResolutionId ?? null,
      expectedCurrentRevision: existing?.expectedCurrentRevision ?? 0,
      identityId: existing?.identityId ?? null,
      identityKeyDigest,
      layer: 'mid',
      resolutionKind: 'single',
      resolvedValueJson: { value: 'new semantic memory' },
      semanticKind: existing?.semanticKind ?? 'fact',
      semanticStatus: 'current',
    },
    traceId: frozen.traceId,
  };
}

function leaseFor(jobId: string): MemoryP2LeaseToken {
  return {
    epoch: 1,
    expiresAt: new Date('2029-01-01T00:00:00.000Z'),
    owner: `runtime-test:${jobId}`,
  };
}

function aiJobData(input: {
  actorId: string;
  id: string;
  jobType: 'long_session_end' | 'mid_final' | 'mid_online' | 'working_memory_maintain';
  projectId: string;
  status: 'running' | 'succeeded';
  triggerDedupeKey: string;
}): Prisma.AiJobUncheckedCreateInput {
  const now = new Date();
  return {
    completedAt: input.status === 'succeeded' ? now : null,
    contextBuilderVersion: 'memory-p2-context-v1',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    id: input.id,
    inputHash: sha256(`input:${input.id}`),
    jobType: input.jobType,
    modelName: 'provider-neutral-local-test',
    policyRevision: 1,
    projectId: input.projectId,
    promptVersion: 'memory-p2-v1',
    requestId: randomUUID(),
    requestIdentityHash: sha256(`request:${input.id}`),
    requestedBy: input.actorId,
    retentionPolicyVersion: 1,
    schemaVersion: 'memory-semantic-proposal-v1',
    startedAt: now,
    status: input.status,
    triggerDedupeKey: input.triggerDedupeKey,
  } as const;
}

async function businessCounts(
  prisma: PrismaService,
  aiJobId: string,
): Promise<{
  claims: number;
  evidences: number;
  long: number;
  resolutions: number;
  revisions: number;
}> {
  const [claims, resolutions, revisions, evidences, long] = await Promise.all([
    prisma.memoryClaim.count({ where: { aiJobId } }),
    prisma.memoryResolution.count({ where: { aiJobId } }),
    prisma.memoryLayerRevision.count({ where: { sourceJobId: aiJobId } }),
    prisma.memoryEvidenceAuthority.count(),
    prisma.memoryLongJobProjection.count({ where: { aiJobId } }),
  ]);
  return { claims, evidences, long, resolutions, revisions };
}

interface RuntimeFixture {
  actorId: string;
  p1JobId: string;
  projectId: string;
  segmentDigest: string;
  segmentId: string;
  sessionId: string;
  snapshotId: string;
  sourceAuthorityId: string;
  sourceClaimId: string;
  sourceResolutionId: string;
  streamId: string;
  threadId: string;
  threadRevisionId: string;
}

async function prepareRuntimeFixture(
  prisma: PrismaService,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
): Promise<void> {
  const inputSegmentId = randomUUID();
  const inputMemoryId = randomUUID();
  const outputId = randomUUID();
  const segmentManifestHash = manifestHash([
    `${inputSegmentId}:${fixture.segmentId}:0:1:${fixture.segmentDigest}`,
  ]);
  const memoryManifestHash = manifestHash([`${inputMemoryId}:${fixture.sourceResolutionId}:1`]);

  await prisma.projectAssignment.create({
    data: {
      projectId: fixture.projectId,
      userId: fixture.actorId,
    },
  });
  await prisma.consentRecord.create({
    data: {
      consentMethod: 'written',
      consentTextVersion: 'memory-p2-runtime-fixture-v1',
      consentedAt: new Date('2026-08-22T00:00:00.000Z'),
      createdBy: fixture.actorId,
      projectId: fixture.projectId,
    },
  });
  await prisma.aiJobSessionScope.create({
    data: {
      aiJobId: fixture.p1JobId,
      eligibleSegmentCount: 1,
      id: randomUUID(),
      inputOrder: 0,
      maxSegmentId: fixture.segmentId,
      maxSegmentStartMs: 0,
      scopeReason: 'memory-p2-runtime-fixture',
      segmentManifestHash,
      sessionId: fixture.sessionId,
      speakerRoleRevision: 1,
    },
  });
  await prisma.aiJobInputSegment.create({
    data: {
      aiJobId: fixture.p1JobId,
      contentKind: 'conversation',
      effectiveTextDigest: fixture.segmentDigest,
      id: inputSegmentId,
      inputOrder: 0,
      roleAuthority: 'user_confirmed',
      sessionId: fixture.sessionId,
      speakerRoleRevision: 1,
      textRevision: 0,
      transcriptSegmentId: fixture.segmentId,
      trustedEffectiveRole: 'elder',
    },
  });
  await prisma.memoryClaimEvidence.create({
    data: {
      aiJobInputSegmentId: inputSegmentId,
      evidenceOrder: 0,
      id: randomUUID(),
      memoryClaimId: fixture.sourceClaimId,
      transcriptSegmentId: fixture.segmentId,
    },
  });
  await prisma.aiJobInputMemory.create({
    data: {
      aiJobId: fixture.p1JobId,
      id: inputMemoryId,
      inputOrder: 0,
      memoryResolutionId: fixture.sourceResolutionId,
      resolutionRevision: 1,
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.aiDerivedOutput.create({
      data: {
        aiJobId: fixture.p1JobId,
        businessOutputId: fixture.sourceResolutionId,
        expectedMemoryCount: 1,
        expectedMemoryManifestHash: memoryManifestHash,
        expectedQuestionCount: 0,
        expectedQuestionManifestHash: EMPTY_MANIFEST_HASH,
        expectedSegmentCount: 1,
        expectedSegmentManifestHash: segmentManifestHash,
        id: outputId,
        outputType: 'memory_resolution',
        projectId: fixture.projectId,
      },
    });
    await tx.memoryResolution.update({
      data: {
        aiDerivedOutputId: outputId,
        aiJobId: fixture.p1JobId,
        authority: 'automatic',
        memoryRetentionRootId: null,
      },
      where: { id: fixture.sourceResolutionId },
    });
  });
  await prisma.aiOutputSegmentDependency.create({
    data: {
      aiDerivedOutputId: outputId,
      aiJobInputSegmentId: inputSegmentId,
      dependencyOrder: 0,
      id: randomUUID(),
    },
  });
  await prisma.aiOutputMemoryDependency.create({
    data: {
      aiDerivedOutputId: outputId,
      aiJobInputMemoryId: inputMemoryId,
      dependencyOrder: 0,
      id: randomUUID(),
    },
  });
  await prisma.interviewContextSnapshot.create({
    data: {
      actualQuestionCount: 0,
      actualQuestionManifestHash: EMPTY_MANIFEST_HASH,
      aiDerivedOutputId: outputId,
      aiJobId: fixture.p1JobId,
      consumerSessionId: fixture.sessionId,
      id: fixture.snapshotId,
      memoryCount: 1,
      memoryManifestHash,
      policyRevision: 1,
      projectId: fixture.projectId,
    },
  });
  await prisma.contextSnapshotMemory.create({
    data: {
      contextSnapshotId: fixture.snapshotId,
      inputOrder: 0,
      memoryResolutionId: fixture.sourceResolutionId,
      resolutionRevision: 1,
    },
  });
}

async function runtimeSourceManifestHash(
  prisma: PrismaService,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
): Promise<string> {
  const [snapshotRows, resolutions, claims, evidence] = await Promise.all([
    prisma.memoryWorkingSnapshotResolution.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { snapshotId: fixture.snapshotId },
    }),
    prisma.memoryResolution.findMany({ where: { id: fixture.sourceResolutionId } }),
    prisma.memoryClaim.findMany({ where: { id: fixture.sourceClaimId } }),
    prisma.memoryClaimEvidence.findMany({
      orderBy: { evidenceOrder: 'asc' },
      where: { memoryClaimId: fixture.sourceClaimId },
    }),
  ]);
  const resolution = resolutions[0];
  const claim = claims[0];
  if (
    resolution === undefined ||
    claim === undefined ||
    resolution.authorityId === null ||
    snapshotRows.length !== 1
  )
    throw new Error('runtime fixture source rows are incomplete');
  const snapshotRow = snapshotRows[0];
  if (snapshotRow === undefined) throw new Error('runtime fixture snapshot row is missing');
  const evidenceMembership: Record<string, unknown>[] = [];
  const evidenceRefs = evidence.map((link) => `evidence:${link.transcriptSegmentId}`);
  for (const [inputOrder, ref] of evidenceRefs.entries()) {
    evidenceMembership.push({
      content_kind: 'conversation',
      effective_text_digest: fixture.segmentDigest,
      evidence_ref_id: ref,
      input_order: inputOrder,
      segment_id: fixture.segmentId,
      session_id: fixture.sessionId,
      speaker_role_revision: 1,
      text_revision: 0,
      trusted_role: 'elder',
    });
  }
  const state = {
    canonical_key: resolution.canonicalKey,
    claims: [
      {
        claim_key: claim.canonicalKey,
        evidence_ref_ids: evidenceRefs,
        source_claim_ref_id: `claim:${claim.id}`,
        value: claim.valueJson,
        value_kind: claim.valueKind,
      },
    ],
    memory_tag: resolution.memoryType,
    resolution_kind: resolution.resolutionKind,
    semantic_kind: resolution.semanticKind,
    semantic_status: resolution.semanticStatus,
    value: resolution.resolvedValueJson,
    value_kind: 'exact',
  } as const;
  const sourceMembers = [
    {
      authority: 'automatic' as const,
      content_digest: semanticContentDigest(state),
      input_order: snapshotRow.inputOrder,
      project_id: resolution.projectId,
      resolution_id: resolution.id,
      resolution_revision: resolution.resolutionRevision,
      semantic_state: state,
      session_id: resolution.sourceSessionId ?? fixture.sessionId,
      source_kind: 'working_resolution' as const,
      source_ref_id: `src:working_resolution:${resolution.authorityId}`,
    },
  ];
  expect(semanticEvidenceManifestHash(evidenceMembership)).toHaveLength(64);
  return semanticSourceManifestHash(sourceMembers, evidenceMembership);
}

function runtimeTriggerRequest(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  sourceManifestHash: string,
  kind: MemoryP2MidTriggerKind,
): MemoryP2AnyTriggerRequest {
  const request = {
    kind,
    p1SourceContractVersion: 'memory-maintainer-v1.2' as const,
    p1TerminalJobId: kind === 'session_final_flush' ? fixture.p1JobId : null,
    policy: {
      aiPolicyRevision: 1,
      deletionScopeDigest: deletionScopeAuthorityDigest(fixture.projectId, [fixture.sessionId], 1),
      p2PolicyRevision: 'memory-p2-policy-v1',
      p2RetentionPolicyVersion: 'memory-p2-retention-v1',
      retentionPolicyVersion: 1,
    },
    projectId: fixture.projectId,
    sessionId: fixture.sessionId,
    sourceCheckpointRootIdentity: sha256(`p2-runtime-root:${kind}:${fixture.projectId}`),
    sourceManifestHash,
    sourceSnapshotId: fixture.snapshotId,
    sourceSnapshotRevision: 1,
    targetLayerRootIdentity: sha256(`p2-runtime-target:${kind}:${fixture.projectId}`),
    targetRevision: 0,
  };
  return kind === 'session_final_flush'
    ? { ...request, finalTailManifestHash: sha256(`p2-runtime-final-tail:${fixture.sessionId}`) }
    : request;
}

function requireJobId(result: MemoryP2RunResult): string {
  if (!('jobId' in result)) throw new Error('expected a durable P2 job result');
  return result.jobId;
}

async function runtimeCounts(
  prisma: PrismaService,
  projectId: string,
): Promise<{
  longJobs: number;
  midJobs: number;
  revisions: number;
  unavailableJobs: number;
}> {
  const [midJobs, longJobs, revisions, unavailableJobs] = await Promise.all([
    prisma.aiJob.count({ where: { jobType: { in: ['mid_online', 'mid_final'] }, projectId } }),
    prisma.aiJob.count({ where: { jobType: 'long_session_end', projectId } }),
    prisma.memoryLayerRevision.count({ where: { projectId } }),
    prisma.aiJob.count({ where: { projectId, status: 'unavailable' } }),
  ]);
  return { longJobs, midJobs, revisions, unavailableJobs };
}

class ManualClock {
  public constructor(private current: Date) {}

  public now(): Date {
    return new Date(this.current);
  }

  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class RacyDeletionScopeReader extends DeletionScopeReader {
  public calls = 0;

  public override assertNoActiveScope(
    ..._args: [string, readonly string[]]
  ): Promise<DeletionScopeSnapshot> {
    void _args;
    this.calls += 1;
    return Promise.resolve({ fenceRevision: this.calls === 1 ? 1 : 2 });
  }
}

class DeterministicNewSlotMemoryP2Provider implements MemoryP2ProviderPort {
  private readonly delegate = new DeterministicMemoryP2Provider('test');

  public async propose(
    context: MemoryP2SemanticContext,
    signal: AbortSignal,
  ): Promise<MemoryP2SemanticProposal> {
    const proposal = await this.delegate.propose(context, signal);
    if (context.mode === 'session_end_to_long') return proposal;
    return {
      ...proposal,
      proposals: proposal.proposals.map((item) => {
        const canonicalKey = `${item.proposed_state.canonical_key}:p2-integration`;
        return {
          ...item,
          proposed_state: {
            ...item.proposed_state,
            canonical_key: canonicalKey,
            claims: item.proposed_state.claims.map((claim) => ({
              ...claim,
              claim_key: canonicalKey,
            })),
          },
          target: { existing_source_ref_id: null, kind: 'new_slot' as const },
        };
      }),
    };
  }
}

async function cleanupFixture(
  prisma: PrismaService,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL elder.p2_cleanup = 'on'");
    const [
      jobRows,
      checkpointRows,
      layerIdentityRows,
      layerRevisionRows,
      traceRows,
      sessionRows,
      threadRows,
      derivedOutputRows,
      contextSnapshotRows,
    ] = await Promise.all([
      tx.aiJob.findMany({
        select: { id: true },
        where: { projectId: fixture.projectId },
      }),
      tx.memoryEvolutionCheckpoint.findMany({
        select: { id: true },
        where: { projectId: fixture.projectId },
      }),
      tx.memoryLayerIdentity.findMany({
        select: { id: true },
        where: { projectId: fixture.projectId },
      }),
      tx.memoryLayerRevision.findMany({
        select: { id: true },
        where: { projectId: fixture.projectId },
      }),
      tx.decisionTrace.findMany({
        select: { id: true },
        where: { projectId: fixture.projectId },
      }),
      tx.interviewSession.findMany({
        select: { id: true },
        where: { projectId: fixture.projectId },
      }),
      tx.memoryThread.findMany({
        select: { id: true },
        where: { projectId: fixture.projectId },
      }),
      tx.aiDerivedOutput.findMany({
        select: { id: true },
        where: { projectId: fixture.projectId },
      }),
      tx.interviewContextSnapshot.findMany({
        select: { id: true },
        where: { projectId: fixture.projectId },
      }),
    ]);
    const jobIds = jobRows.map((row) => row.id);
    const checkpointIds = checkpointRows.map((row) => row.id);
    const layerIdentityIds = layerIdentityRows.map((row) => row.id);
    const layerRevisionIds = layerRevisionRows.map((row) => row.id);
    const traceIds = traceRows.map((row) => row.id);
    const sessionIds = sessionRows.map((row) => row.id);
    const threadIds = threadRows.map((row) => row.id);
    const derivedOutputIds = derivedOutputRows.map((row) => row.id);
    const contextSnapshotIds = contextSnapshotRows.map((row) => row.id);
    const inputSegmentRows = await tx.aiJobInputSegment.findMany({
      select: { id: true },
      where: { aiJobId: { in: jobIds } },
    });
    const inputSegmentIds = inputSegmentRows.map((row) => row.id);
    const longProjectionRows = await tx.memoryLongJobProjection.findMany({
      select: { id: true },
      where: { aiJobId: { in: jobIds } },
    });
    const longProjectionIds = longProjectionRows.map((row) => row.id);
    const resolutionRows = await tx.memoryResolution.findMany({
      select: { id: true },
      where: { projectId: fixture.projectId },
    });
    const resolutionIds = resolutionRows.map((row) => row.id);
    const claimRows = await tx.memoryClaim.findMany({
      select: { id: true },
      where: { projectId: fixture.projectId },
    });
    const claimIds = claimRows.map((row) => row.id);
    const snapshotRows = await tx.memoryWorkingSnapshot.findMany({
      select: { id: true },
      where: { projectId: fixture.projectId },
    });
    const snapshotIds = snapshotRows.map((row) => row.id);

    // Remove reference/provenance children before their RESTRICT parents.
    await tx.memoryLongJobProjectionSource.deleteMany({
      where: { projectionId: { in: longProjectionIds } },
    });
    await tx.memoryP2RetentionTarget.deleteMany({ where: { aiJobId: { in: jobIds } } });
    await tx.decisionTraceMemorySourceReference.deleteMany({
      where: { traceId: { in: traceIds } },
    });
    await tx.decisionTraceMemorySemantic.deleteMany({ where: { traceId: { in: traceIds } } });
    await tx.memoryEvidenceBridge.deleteMany({
      where: { aiJobInputSegmentId: { in: inputSegmentIds } },
    });
    await tx.memoryClaimEvidence.deleteMany({
      where: {
        OR: [{ aiJobInputSegmentId: { in: inputSegmentIds } }, { memoryClaimId: { in: claimIds } }],
      },
    });
    await tx.aiOutputSegmentDependency.deleteMany({
      where: { aiDerivedOutputId: { in: derivedOutputIds } },
    });
    await tx.aiOutputMemoryDependency.deleteMany({
      where: { aiDerivedOutputId: { in: derivedOutputIds } },
    });
    await tx.contextSnapshotMemory.deleteMany({
      where: { contextSnapshotId: { in: contextSnapshotIds } },
    });
    await tx.contextSnapshotActualQuestion.deleteMany({
      where: { contextSnapshotId: { in: contextSnapshotIds } },
    });
    await tx.interviewContextSnapshot.deleteMany({ where: { id: { in: contextSnapshotIds } } });
    await tx.memoryLayerRevisionMember.deleteMany({
      where: { revisionId: { in: layerRevisionIds } },
    });
    await tx.memoryEvolutionCheckpointMember.deleteMany({
      where: { checkpointId: { in: checkpointIds } },
    });
    await tx.memoryResolutionMember.deleteMany({
      where: {
        OR: [{ memoryResolutionId: { in: resolutionIds } }, { memoryClaimId: { in: claimIds } }],
      },
    });
    await tx.memoryWorkingSnapshotResolution.deleteMany({
      where: { snapshotId: { in: snapshotIds } },
    });
    await tx.memoryWorkingSnapshotThread.deleteMany({ where: { snapshotId: { in: snapshotIds } } });
    await tx.memoryWorkingSnapshotBoundary.deleteMany({
      where: { snapshotId: { in: snapshotIds } },
    });
    await tx.aiJobInputMemory.deleteMany({ where: { aiJobId: { in: jobIds } } });
    await tx.aiJobSessionScope.deleteMany({ where: { aiJobId: { in: jobIds } } });
    await tx.memoryWorkingConsumption.deleteMany({ where: { projectId: fixture.projectId } });

    await tx.memoryLongJobProjection.deleteMany({ where: { id: { in: longProjectionIds } } });
    await tx.memoryP2JobProjection.deleteMany({ where: { aiJobId: { in: jobIds } } });
    await tx.memoryLayerRevision.deleteMany({ where: { id: { in: layerRevisionIds } } });
    await tx.memoryLayerIdentity.deleteMany({ where: { id: { in: layerIdentityIds } } });
    await tx.memoryEvolutionCheckpoint.deleteMany({ where: { id: { in: checkpointIds } } });
    await tx.memoryResolution.deleteMany({ where: { id: { in: resolutionIds } } });
    await tx.memoryClaim.deleteMany({ where: { id: { in: claimIds } } });
    await tx.memoryEvidenceAuthority.deleteMany({ where: { projectId: fixture.projectId } });
    await tx.memoryResolutionAuthority.deleteMany({ where: { projectId: fixture.projectId } });
    await tx.memoryWorkingSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
    await tx.decisionTrace.deleteMany({ where: { id: { in: traceIds } } });

    // This is intentionally before transcript/session deletion: the seeded transcript
    // must not retain any AiJobInputSegment FK from this suite.
    await tx.aiJobInputSegment.deleteMany({ where: { id: { in: inputSegmentIds } } });
    await tx.aiJob.deleteMany({ where: { id: { in: jobIds } } });
    await tx.memoryThreadRevision.deleteMany({ where: { sourceSessionId: { in: sessionIds } } });
    await tx.memoryThreadRevision.deleteMany({ where: { threadId: { in: threadIds } } });
    await tx.memoryThread.deleteMany({ where: { projectId: fixture.projectId } });
    await tx.transcriptSegment.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.speakerStream.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.interviewSession.deleteMany({ where: { projectId: fixture.projectId } });
    await tx.memoryRetentionRoot.deleteMany({ where: { projectId: fixture.projectId } });
    await tx.elderProject.deleteMany({ where: { id: fixture.projectId } });
    await tx.user.deleteMany({ where: { id: fixture.actorId } });
  });
}
