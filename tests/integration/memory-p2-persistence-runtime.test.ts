import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalDigest } from '../../apps/api/src/memory/memory-persistence-contract.js';
import {
  effectiveTextDigest,
  manifestHash,
  sha256,
} from '../../apps/api/src/ai-runtime/ai-provenance.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { Prisma } from '../../apps/api/src/generated/prisma/client.js';
import { MemoryP2PersistenceReader } from '../../apps/api/src/memory/memory-p2-persistence.reader.js';
import { MemoryP2PersistenceRepository } from '../../apps/api/src/memory/memory-p2-persistence.repository.js';
import {
  memoryP2CheckpointManifestHash,
  memoryP2LongSourceManifestHash,
  memoryP2SourceSessionSetHash,
  type MemoryP2ClaimInput,
  type MemoryP2CommitInput,
  type MemoryP2FreezeCheckpointInput,
  type MemoryP2LeaseToken,
} from '../../apps/api/src/memory/memory-p2-persistence.types.js';

describe('MEMORY-T5-T8-P2-C-RUNTIME-001 repository runtime', () => {
  let prisma: PrismaService;
  let repository: MemoryP2PersistenceRepository;
  let reader: MemoryP2PersistenceReader;
  let fixture: Awaited<ReturnType<typeof seedFixture>>;

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
    repository = new MemoryP2PersistenceRepository(prisma);
    reader = new MemoryP2PersistenceReader(prisma);
    fixture = await seedFixture(prisma);
  });

  afterAll(async () => prisma.$disconnect());

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
    const longScopeDigest = sha256(`scope:${longJob.id}`);
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
  const text = `虚构的校园记忆证据${suffix}`;
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
  const deletionScopeDigest = sha256(`scope:${job.id}`);
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
      authorityId ?? frozen.targetSlotDigest,
    ]);
  return {
    aiJobId: frozen.aiJobId,
    checkpointId: frozen.checkpointId,
    claims: [claim],
    commitDigest: sha256(`commit:${frozen.aiJobId}`),
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
