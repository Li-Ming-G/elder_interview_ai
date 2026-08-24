import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AiJobCoordinatorService } from '../../apps/api/src/ai-runtime/ai-job-coordinator.service.js';
import { AiOutputEligibilityService } from '../../apps/api/src/ai-runtime/ai-output-eligibility.service.js';
import { AiRetentionService } from '../../apps/api/src/ai-runtime/ai-retention.service.js';
import { DecisionTraceReader } from '../../apps/api/src/ai-runtime/decision-trace.reader.js';
import {
  DecisionTraceService,
  decisionTraceMemoryTriggerManifest,
} from '../../apps/api/src/ai-runtime/decision-trace.service.js';
import { LocalTestDeletionScopeFixtureReader } from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import {
  canonicalJson,
  effectiveTextDigest,
  manifestHash,
  sha256,
} from '../../apps/api/src/ai-runtime/ai-provenance.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import type { AiJob } from '../../apps/api/src/generated/prisma/client.js';
import { InterviewContextService } from '../../apps/api/src/memory/interview-context.service.js';
import { CurrentMemoryReader } from '../../apps/api/src/memory/memory.service.js';
import {
  LocalTestMemoryMaintainerProvider,
  MemoryMaintainerProvider,
  type MemoryMaintainerContextV12,
  type MemoryMaintainerOutputV12,
} from '../../apps/api/src/memory/memory-maintainer.provider.js';
import {
  MEMORY_MAINTAINER_RUNTIME_CONFIG,
  MemoryMaintainerClock,
  MemoryMaintainerFailpoint,
  type MemoryMaintainerFailpointStage,
  MemoryMaintainerRuntime,
  type MemoryMaintainerRuntimeConfig,
} from '../../apps/api/src/memory/memory-maintainer.runtime.js';
import { MemoryMaintainerV12Validator } from '../../apps/api/src/memory/memory-maintainer.validator.js';
import { MemoryWorkingSnapshotReader } from '../../apps/api/src/memory/memory-working-snapshot.reader.js';
import { RealtimeRuntimeService } from '../../apps/api/src/realtime-transcription/realtime-runtime.service.js';

describe('MEMORY-T2-T4-RUNTIME-001 PostgreSQL runtime and recovery', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobs: AiJobCoordinatorService;
  let eligibility: AiOutputEligibilityService;
  let retention: AiRetentionService;
  let traceReader: DecisionTraceReader;
  let traces: DecisionTraceService;
  let realtime: RealtimeRuntimeService;
  let validator: MemoryMaintainerV12Validator;
  let deletion: LocalTestDeletionScopeFixtureReader;
  let snapshots: MemoryWorkingSnapshotReader;
  let currentMemory: CurrentMemoryReader;
  let contexts: InterviewContextService;
  let profileConfig: MemoryMaintainerRuntimeConfig;

  const actorId = randomUUID();
  const projectId = randomUUID();
  const clock = new ManualClock(new Date('2030-01-01T00:00:00.000Z'));
  let initialized = false;
  let sequenceNo = 0;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-memory-maintainer-retention-pepper',
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-memory-maintainer-auth-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    jobs = app.get(AiJobCoordinatorService);
    eligibility = app.get(AiOutputEligibilityService);
    retention = app.get(AiRetentionService);
    traceReader = app.get(DecisionTraceReader);
    traces = app.get(DecisionTraceService);
    realtime = app.get(RealtimeRuntimeService);
    validator = app.get(MemoryMaintainerV12Validator);
    deletion = app.get(LocalTestDeletionScopeFixtureReader);
    snapshots = app.get(MemoryWorkingSnapshotReader);
    currentMemory = app.get(CurrentMemoryReader);
    contexts = app.get(InterviewContextService);
    profileConfig = app.get(MEMORY_MAINTAINER_RUNTIME_CONFIG);
    await prisma.user.create({
      data: {
        displayName: 'Fictional memory runtime listener',
        email: `memory-runtime-${actorId}@example.test`,
        id: actorId,
        passwordHash: 'test-only',
        role: 'interviewer',
      },
    });
    await prisma.elderProject.create({
      data: { createdBy: actorId, displayName: 'Fictional memory runtime elder', id: projectId },
    });
    await prisma.projectAssignment.create({ data: { projectId, userId: actorId } });
    await prisma.consentRecord.create({
      data: {
        consentMethod: 'electronic',
        consentTextVersion: 'fictional-memory-runtime-v1',
        consentType: 'recording_transcription_ai',
        consentedAt: new Date(),
        createdBy: actorId,
        projectId,
        status: 'valid',
      },
    });
    initialized = true;
  });

  afterAll(async () => {
    if (!initialized) return;
    deletion.clear();
    const resolutionIds = (
      await prisma.memoryResolution.findMany({ select: { id: true }, where: { projectId } })
    ).map(({ id }) => id);
    const claimIds = (
      await prisma.memoryClaim.findMany({ select: { id: true }, where: { projectId } })
    ).map(({ id }) => id);
    await prisma.memoryResolutionMember.deleteMany({
      where: { memoryResolutionId: { in: resolutionIds } },
    });
    await prisma.memoryClaimEvidence.deleteMany({ where: { memoryClaimId: { in: claimIds } } });
    const contextIds = (
      await prisma.interviewContextSnapshot.findMany({
        select: { id: true },
        where: { projectId },
      })
    ).map(({ id }) => id);
    await prisma.contextSnapshotMemory.deleteMany({
      where: { contextSnapshotId: { in: contextIds } },
    });
    await prisma.contextSnapshotActualQuestion.deleteMany({
      where: { contextSnapshotId: { in: contextIds } },
    });
    await prisma.aiJobInputMemory.deleteMany({
      where: {
        aiJobId: {
          in: (await prisma.aiJob.findMany({ select: { id: true }, where: { projectId } })).map(
            ({ id }) => id,
          ),
        },
      },
    });
    await prisma.memoryResolution.deleteMany({ where: { projectId } });
    await prisma.memoryClaim.deleteMany({ where: { projectId } });
    await prisma.aiJob.deleteMany({ where: { projectId } });
    await prisma.elderProject.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await app.close();
  });

  it('freezes new and overlap membership, consumes only new, and keeps revision zero exact', async () => {
    const first = await seedSession(['工作记忆[episode:event:first]=第一段']);
    const runtime = createRuntime(new LocalTestMemoryMaintainerProvider());
    await runtime.requestFinalFlush(first.sessionId);
    await addSegment(first.sessionId, first.streamId, 1, '倾听员承接', 'interviewer');
    const secondId = await addSegment(
      first.sessionId,
      first.streamId,
      2,
      '工作记忆[episode:event:second]=第二段',
      'elder',
    );
    await runtime.requestFinalFlush(first.sessionId);

    const jobsForSession = await maintainerJobs(first.sessionId);
    expect(jobsForSession).toHaveLength(2);
    const latest = jobsForSession.at(-1);
    expect(latest?.status).toBe('succeeded');
    const memberships = await prisma.memoryMaintenanceInputSegment.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { aiJobId: latest?.id },
    });
    expect(memberships.map(({ membershipKind }) => membershipKind)).toEqual([
      'overlap',
      'overlap',
      'new',
    ]);
    const consumptions = await prisma.memoryWorkingConsumption.findMany({
      where: { sessionId: first.sessionId },
    });
    expect(consumptions).toHaveLength(2);
    expect(
      consumptions.find(({ transcriptSegmentId }) => transcriptSegmentId === secondId),
    ).toMatchObject({ textRevision: 0 });
    const latestTrace = await prisma.decisionTrace.findFirstOrThrow({
      where: { aiJobId: latest?.id },
    });
    const latestObservation = await prisma.decisionTraceMemoryTriggerObservation.findUniqueOrThrow({
      include: { selectedNewMemberships: true },
      where: { traceId: latestTrace.id },
    });
    expect(latestObservation).toMatchObject({
      aiJobId: latest?.id,
      minimumUsefulCharacters: 2,
      selectedNewSegmentCount: 1,
      triggerIdentity: latest?.triggerDedupeKey,
      triggerKind: 'session_final_flush',
    });
    expect(latestObservation.selectedNewMemberships).toEqual([
      expect.objectContaining({ inputOrder: 0, transcriptSegmentId: secondId }),
    ]);
    const readableTrace = await traceReader.read(actorId, latestTrace.id);
    const readableObservation = readableTrace.trace.memoryTriggerObservation;
    if (readableObservation === null) throw new Error('READABLE_MEMORY_TRIGGER_MISSING');
    expect(readableObservation.selectedNewManifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(readableObservation)).not.toContain('第二段');
  });

  it.each([
    {
      config: { batchThreshold: 2, timeThresholdMs: 2 * 60 * 60 * 1_000 },
      expected: 'batch_threshold',
      mode: 'scanner',
    },
    {
      config: { batchThreshold: 99, timeThresholdMs: 30_000 },
      expected: 'time_threshold',
      mode: 'scanner',
    },
    {
      config: { batchThreshold: 99, timeThresholdMs: 2 * 60 * 60 * 1_000 },
      expected: 'session_final_flush',
      mode: 'final_flush',
    },
  ] as const)(
    'uses cumulative selected fragments for $expected',
    async ({ config, expected, mode }) => {
      const seeded = await seedSession(['Ａ ', '\u3000😀']);
      const provider = new CountingProvider();
      const runtime = createRuntime(provider, undefined, undefined, {
        ...config,
        minimumUsefulCharacters: 2,
      });
      if (mode === 'final_flush') await runtime.requestFinalFlush(seeded.sessionId);
      else await runtime.reconcilePersistedState();

      expect(provider.callCount).toBe(1);
      expect(provider.contexts).toHaveLength(1);
      expect(provider.contexts[0]?.trigger).toMatchObject({
        cumulative_useful_characters: 2,
        kind: expected,
        minimum_useful_characters: 2,
        selected_new_segment_count: 2,
      });
      expect(
        await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
      ).toBe(2);
      expect(
        await prisma.memoryWorkingSnapshot.findFirstOrThrow({
          where: { sourceSessionId: seeded.sessionId },
        }),
      ).toMatchObject({ contractVersion: 'memory-maintainer-v1.2', triggerKind: expected });
    },
  );

  it('keeps an ordinary below-minimum scan at zero jobs, provider calls, and consumption', async () => {
    const seeded = await seedSession(['甲']);
    const provider = new CountingProvider();
    const runtime = createRuntime(provider, undefined, undefined, {
      batchThreshold: 1,
      minimumUsefulCharacters: 2,
      timeThresholdMs: 0,
    });
    await runtime.reconcilePersistedState();

    expect(provider.callCount).toBe(0);
    expect(
      await prisma.aiJob.count({
        where: { triggerDedupeKey: { startsWith: `memory-p1-v1.2:${seeded.sessionId}:` } },
      }),
    ).toBe(0);
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(0);
    expect(
      await prisma.memoryWorkingSnapshot.count({ where: { sourceSessionId: seeded.sessionId } }),
    ).toBe(0);
  });

  it('does not count overlap, interviewer, consumed, or non-conversation text', async () => {
    const seeded = await seedSession([]);
    const consumedId = await addSegment(
      seeded.sessionId,
      seeded.streamId,
      0,
      '这段已经消费且很长',
      'elder',
    );
    await prisma.memoryWorkingConsumption.create({
      data: {
        effectiveTextDigest: effectiveTextDigest('这段已经消费且很长'),
        id: randomUUID(),
        projectId,
        sessionId: seeded.sessionId,
        textRevision: 0,
        transcriptSegmentId: consumedId,
      },
    });
    await addSegment(seeded.sessionId, seeded.streamId, 1, '倾听员的长文本不计', 'interviewer');
    await addSegment(
      seeded.sessionId,
      seeded.streamId,
      2,
      '校准控制内容不计',
      'elder',
      'speaker_calibration',
    );
    await addSegment(seeded.sessionId, seeded.streamId, 3, '甲', 'elder');
    const provider = new CountingProvider();
    const runtime = createRuntime(provider, undefined, undefined, {
      batchThreshold: 1,
      minimumUsefulCharacters: 2,
      timeThresholdMs: 0,
    });
    await runtime.reconcilePersistedState();

    expect(provider.callCount).toBe(0);
    expect(
      await prisma.aiJob.count({
        where: { triggerDedupeKey: { startsWith: `memory-p1-v1.2:${seeded.sessionId}:` } },
      }),
    ).toBe(0);
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(1);
  });

  it('does not let text beyond the selected-new cap satisfy the minimum', async () => {
    const seeded = await seedSession(Array.from({ length: 78 }, () => ' \t'));
    await addSegment(seeded.sessionId, seeded.streamId, 78, '足够', 'elder');
    const provider = new CountingProvider();
    const runtime = createRuntime(provider, undefined, undefined, {
      batchThreshold: 1,
      minimumUsefulCharacters: 2,
      timeThresholdMs: 0,
    });
    await runtime.requestFinalFlush(seeded.sessionId);

    expect(provider.callCount).toBe(0);
    expect(await runtime.terminalJobForSession(seeded.sessionId)).toMatchObject({
      failureCode: 'MEMORY_UNJUDGED',
      status: 'cancelled',
    });
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(0);
    expect(
      await prisma.memoryWorkingSnapshot.count({ where: { sourceSessionId: seeded.sessionId } }),
    ).toBe(0);
  });

  it('persists an untagged Fact and lets metadata change without changing semantic identity', async () => {
    const seeded = await seedSession(['工作记忆[episode:tag.optional]=base']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
    await promoteCurrentMemoryToAcceptedFact(seeded.sessionId, 'tag.optional');
    const first = await prisma.memoryResolution.findFirstOrThrow({
      where: { canonicalKey: 'tag.optional', projectId, status: 'current' },
    });
    expect(first).toMatchObject({
      memoryType: null,
      resolutionRevision: 1,
      semanticKind: 'fact',
    });
    profileConfig.enabled = true;
    try {
      expect(
        (await currentMemory.list(actorId, projectId)).find(({ id }) => id === first.id),
      ).toMatchObject({ memoryType: null, semanticKind: 'fact' });
    } finally {
      profileConfig.enabled = false;
    }

    await addSegment(seeded.sessionId, seeded.streamId, 1, '标签只作元数据', 'elder');
    await createRuntime(new TagChangeProvider()).requestFinalFlush(seeded.sessionId);
    const current = await prisma.memoryResolution.findFirstOrThrow({
      where: { canonicalKey: 'tag.optional', projectId, status: 'current' },
    });
    expect(current).toMatchObject({
      memoryType: 'event',
      resolutionRevision: 2,
      semanticKind: 'fact',
      supersedesResolutionId: first.id,
    });
    expect(
      await prisma.memoryResolution.count({
        where: { canonicalKey: 'tag.optional', projectId, status: 'current' },
      }),
    ).toBe(1);
    profileConfig.enabled = true;
    try {
      expect(
        (await currentMemory.list(actorId, projectId)).find(({ id }) => id === current.id),
      ).toMatchObject({ memoryType: 'event', semanticKind: 'fact' });
    } finally {
      profileConfig.enabled = false;
    }
  });

  it('does not reuse another current Fact authority for a fresh ordinary Fact', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:authority.bound]=基线']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
    await promoteCurrentMemoryToAcceptedFact(seeded.sessionId, 'authority.bound');
    await addSegment(seeded.sessionId, seeded.streamId, 1, '普通故事上下文', 'elder');
    await expect(
      createRuntime(new OrdinaryFactProvider()).requestFinalFlush(seeded.sessionId),
    ).rejects.toThrow('FACT_EXPLICIT_ELDER_EVIDENCE_REQUIRED');
    expect(
      await prisma.memoryResolution.count({ where: { canonicalKey: 'ordinary.new', projectId } }),
    ).toBe(0);
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(1);
  });

  it.each(['BRANCH', 'RELATED'] as const)(
    'rejects an ordinary-story fresh %s Fact beside an existing Fact',
    async (kind) => {
      const canonicalKey = `authority.${kind.toLowerCase()}`;
      const seeded = await seedSession([`工作记忆[episode:event:${canonicalKey}]=基线`]);
      await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
        seeded.sessionId,
      );
      await promoteCurrentMemoryToAcceptedFact(seeded.sessionId, canonicalKey);
      await addSegment(seeded.sessionId, seeded.streamId, 1, '普通故事上下文', 'elder');
      await expect(
        createRuntime(new OrdinaryFactProvider(kind)).requestFinalFlush(seeded.sessionId),
      ).rejects.toThrow('FACT_EXPLICIT_ELDER_EVIDENCE_REQUIRED');
      expect(
        await prisma.memoryResolution.count({
          where: { canonicalKey: `ordinary.${kind.toLowerCase()}`, projectId },
        }),
      ).toBe(0);
    },
  );

  it('preserves legacy-null authority as unavailable and rejects a partial upgrade', async () => {
    const rootId = randomUUID();
    await prisma.memoryRetentionRoot.create({
      data: {
        expiresAt: new Date('2031-01-01T00:00:00.000Z'),
        id: rootId,
        projectId,
        retentionPolicyVersion: 1,
        sourceKind: 'system_migration',
        sourceOperationId: randomUUID(),
      },
    });
    const claimId = randomUUID();
    await prisma.memoryClaim.create({
      data: {
        authority: 'system_migration',
        canonicalKey: 'legacy.sentinel',
        id: claimId,
        memoryRetentionRootId: rootId,
        memoryType: 'event',
        normalizedValueDigest: 'a'.repeat(64),
        projectId,
        valueJson: { value: 'legacy' },
        valueKind: 'exact',
      },
    });
    const resolutionId = randomUUID();
    await prisma.memoryResolution.create({
      data: {
        authority: 'system_migration',
        canonicalKey: 'legacy.sentinel',
        id: resolutionId,
        memoryRetentionRootId: rootId,
        memoryType: 'event',
        projectId,
        resolutionKind: 'single',
        resolutionRevision: 1,
        resolvedValueJson: { value: 'legacy' },
      },
    });
    await prisma.memoryResolutionMember.create({
      data: {
        id: randomUUID(),
        memberOrder: 0,
        memoryClaimId: claimId,
        memoryResolutionId: resolutionId,
      },
    });
    expect(await eligibility.isMemoryResolutionEligible(actorId, projectId, resolutionId)).toBe(
      true,
    );
    const legacyProfileMemory = await currentMemory.list(actorId, projectId);
    expect(legacyProfileMemory.some(({ id }) => id === resolutionId)).toBe(true);
    const p1Ids = (
      await prisma.memoryResolution.findMany({
        select: { id: true },
        where: { projectId, provenanceState: 'active' },
      })
    ).map(({ id }) => id);
    expect(legacyProfileMemory.some(({ id }) => p1Ids.includes(id))).toBe(false);
    const seeded = await seedSession(['工作记忆[episode:event:legacy-check]=不读取旧 sentinel']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
    const job = (await maintainerJobs(seeded.sessionId)).at(-1);
    expect(
      await prisma.aiJobInputMemory.count({
        where: { aiJobId: job?.id, memoryResolutionId: resolutionId },
      }),
    ).toBe(0);
    await expect(
      prisma.memoryClaim.create({
        data: {
          authority: 'automatic',
          canonicalKey: 'legacy.partial-invalid',
          id: randomUUID(),
          memoryRetentionRootId: rootId,
          memoryType: 'event',
          normalizedValueDigest: 'b'.repeat(64),
          projectId,
          semanticKind: 'fact',
          valueJson: { value: 'invalid' },
          valueKind: 'exact',
        },
      }),
    ).rejects.toThrow();
  });

  it('coalesces concurrent final notifications into one provider call and one committed snapshot', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:concurrent]=并发通知']);
    const provider = new DeferredProvider();
    const runtime = createRuntime(provider);
    const first = runtime.requestFinalFlush(seeded.sessionId);
    const second = runtime.requestFinalFlush(seeded.sessionId);
    await provider.waitUntilCalled();
    expect(provider.callCount).toBe(1);
    provider.resolveNext();
    await Promise.all([first, second]);
    expect(
      await prisma.memoryWorkingSnapshot.count({ where: { sourceSessionId: seeded.sessionId } }),
    ).toBe(1);
  });

  it('recovers a lost notification through the durable scanner', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:lost-notice]=丢通知']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).reconcilePersistedState();
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(1);
  });

  it('rolls back a normal frozen job and memberships when atomic trace creation fails', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:trace-rollback]=原子回滚']);
    const traceFailure = vi
      .spyOn(traces, 'beginInTransaction')
      .mockRejectedValueOnce(new Error('TRACE_ATOMIC_FAILURE'));
    try {
      await expect(
        createRuntime(new CountingProvider()).requestFinalFlush(seeded.sessionId),
      ).rejects.toThrow('TRACE_ATOMIC_FAILURE');
    } finally {
      traceFailure.mockRestore();
    }
    expect(await maintainerJobs(seeded.sessionId)).toHaveLength(0);
    expect(await prisma.decisionTrace.count({ where: { sessionId: seeded.sessionId } })).toBe(0);
    expect(
      await prisma.memoryMaintenanceInputSegment.count({
        where: { transcriptSegmentId: { in: await sessionSegmentIds(seeded.sessionId) } },
      }),
    ).toBe(0);
    await prisma.interviewSession.update({
      data: { status: 'failed' },
      where: { id: seeded.sessionId },
    });
  });

  it('rolls back a low-content rejected job and source rows when terminal trace creation fails', async () => {
    const seeded = await seedSession(['嗯']);
    const traceFailure = vi
      .spyOn(traces, 'recordTerminalInTransaction')
      .mockRejectedValueOnce(new Error('TRACE_ATOMIC_FAILURE'));
    try {
      await expect(
        createRuntime(new CountingProvider()).requestFinalFlush(seeded.sessionId),
      ).rejects.toThrow('TRACE_ATOMIC_FAILURE');
    } finally {
      traceFailure.mockRestore();
    }
    expect(await maintainerJobs(seeded.sessionId)).toHaveLength(0);
    expect(await prisma.decisionTrace.count({ where: { sessionId: seeded.sessionId } })).toBe(0);
    expect(
      await prisma.aiJobInputSegment.count({
        where: { transcriptSegmentId: { in: await sessionSegmentIds(seeded.sessionId) } },
      }),
    ).toBe(0);
    await prisma.interviewSession.update({
      data: { status: 'failed' },
      where: { id: seeded.sessionId },
    });
  });

  it('rolls back a low-content job when selected-new source drifts before freeze', async () => {
    const seeded = await seedSession(['嗯']);
    const original = jobs.recordRejectedSystemJob.bind(jobs);
    const drift = vi
      .spyOn(jobs, 'recordRejectedSystemJob')
      .mockImplementationOnce(async (request, failureCode) => {
        await prisma.transcriptSegment.updateMany({
          data: { correctedText: '哦', textRevision: 1 },
          where: { sessionId: seeded.sessionId },
        });
        return original(request, failureCode);
      });
    try {
      await expect(
        createRuntime(new CountingProvider()).requestFinalFlush(seeded.sessionId),
      ).rejects.toThrow('MEMORY_UNJUDGED_SOURCE_DRIFT');
    } finally {
      drift.mockRestore();
    }
    expect(await maintainerJobs(seeded.sessionId)).toHaveLength(0);
    expect(await prisma.decisionTrace.count({ where: { sessionId: seeded.sessionId } })).toBe(0);
    await prisma.interviewSession.update({
      data: { status: 'failed' },
      where: { id: seeded.sessionId },
    });
  });

  it('terminalizes concurrent, repeated, and restarted below-minimum final flushes exactly once', async () => {
    const seeded = await seedSession(['嗯']);
    const firstProvider = new CountingProvider();
    const secondProvider = new CountingProvider();
    const firstRuntime = createRuntime(firstProvider);
    const secondRuntime = createRuntime(secondProvider);
    await Promise.all([
      firstRuntime.requestFinalFlush(seeded.sessionId),
      secondRuntime.requestFinalFlush(seeded.sessionId),
    ]);
    await firstRuntime.requestFinalFlush(seeded.sessionId);
    const restartedProvider = new CountingProvider();
    const restartedRuntime = createRuntime(restartedProvider);
    await restartedRuntime.reconcilePersistedState();
    await restartedRuntime.requestFinalFlush(seeded.sessionId);

    expect(
      [firstProvider, secondProvider, restartedProvider]
        .flatMap(({ contexts }) => contexts)
        .some((context) =>
          context.transcript_membership.some(
            (membership) => membership.session_id === seeded.sessionId,
          ),
        ),
    ).toBe(false);
    const terminal = await restartedRuntime.terminalJobForSession(seeded.sessionId);
    expect(terminal).toMatchObject({
      failureCode: 'MEMORY_UNJUDGED',
      status: 'cancelled',
    });
    if (terminal === null || terminal.triggerDedupeKey === null)
      throw new Error('MEMORY_UNJUDGED_TERMINAL_REQUIRED');
    expect(terminal.triggerDedupeKey).toMatch(
      new RegExp(`^memory-p1-v1\\.2:${seeded.sessionId}:final-unjudged:`),
    );
    expect(
      await prisma.aiJob.count({
        where: {
          failureCode: 'MEMORY_UNJUDGED',
          jobType: 'working_memory_maintain',
          triggerDedupeKey: {
            startsWith: `memory-p1-v1.2:${seeded.sessionId}:final-unjudged:`,
          },
        },
      }),
    ).toBe(1);
    const unjudgedTrace = await prisma.decisionTrace.findFirstOrThrow({
      include: {
        memoryTriggerObservation: { include: { selectedNewMemberships: true } },
      },
      where: { aiJobId: terminal.id },
    });
    expect(unjudgedTrace).toMatchObject({
      decisionOutcome: 'unavailable',
      directorInvoked: false,
      errorCode: 'MEMORY_UNJUDGED',
      status: 'unavailable',
    });
    expect(unjudgedTrace.memoryTriggerObservation).toMatchObject({
      cumulativeUsefulCharacters: 1,
      minimumUsefulCharacters: 2,
      selectedNewSegmentCount: 1,
      triggerKind: 'session_final_flush',
    });
    if (unjudgedTrace.memoryTriggerObservation === null)
      throw new Error('MEMORY_TRIGGER_OBSERVATION_REQUIRED');
    const observedMemberships = unjudgedTrace.memoryTriggerObservation.selectedNewMemberships;
    const observedMembership = observedMemberships[0];
    if (observedMembership === undefined) throw new Error('MEMORY_TRIGGER_MEMBERSHIP_REQUIRED');
    const selectedManifestHash = decisionTraceMemoryTriggerManifest(observedMemberships);
    expect(terminal.triggerDedupeKey).toBe(
      `memory-p1-v1.2:${seeded.sessionId}:final-unjudged:${selectedManifestHash.slice(0, 32)}`,
    );
    const [inputSegments, maintenanceInputs, scope] = await Promise.all([
      prisma.aiJobInputSegment.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { aiJobId: terminal.id },
      }),
      prisma.memoryMaintenanceInputSegment.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { aiJobId: terminal.id },
      }),
      prisma.aiJobSessionScope.findFirstOrThrow({ where: { aiJobId: terminal.id } }),
    ]);
    expect(inputSegments).toHaveLength(1);
    const inputSegment = inputSegments[0];
    if (inputSegment === undefined) throw new Error('MEMORY_UNJUDGED_INPUT_REQUIRED');
    expect(maintenanceInputs).toEqual([
      expect.objectContaining({
        inputOrder: 0,
        membershipKind: 'new',
        transcriptSegmentId: observedMembership.transcriptSegmentId,
      }),
    ]);
    expect(scope).toMatchObject({
      eligibleSegmentCount: 1,
      segmentManifestHash: selectedManifestHash,
    });
    expect(terminal.inputHash).toBe(
      sha256(
        canonicalJson({
          context_builder_version: 'memory-maintainer-v1.2',
          job_type: 'working_memory_maintain',
          project_id: projectId,
          selected_new_manifest_hash: selectedManifestHash,
          session_id: seeded.sessionId,
          trigger_identity: terminal.triggerDedupeKey,
        }),
      ),
    );
    expect(await prisma.aiProviderCall.count({ where: { aiJobId: terminal.id } })).toBe(0);
    expect(await prisma.decisionTrace.count({ where: { aiJobId: terminal.id } })).toBe(1);
    await expect(
      jobs.recordRejectedSystemJob(
        {
          actorId,
          contextBuilderVersion: 'memory-maintainer-v1.2',
          exactSegmentIds: [],
          expiresAt: terminal.expiresAt,
          jobType: 'working_memory_maintain',
          projectId,
          requestId: randomUUID(),
          sessionIds: [seeded.sessionId],
          triggerDedupeKey: terminal.triggerDedupeKey,
          trustedRole: 'elder',
        },
        'MEMORY_UNJUDGED',
      ),
    ).rejects.toThrow('AI_REQUEST_IDENTITY_CONFLICT');
    expect(await traceReader.read(actorId, unjudgedTrace.id)).toMatchObject({
      trace: { id: unjudgedTrace.id },
    });
    expect(await businessCounts(seeded.sessionId)).toMatchObject({
      claims: 0,
      consumptions: 0,
      resolutions: 0,
      snapshots: 0,
    });
    expect(await prisma.transcriptSegment.count({ where: { sessionId: seeded.sessionId } })).toBe(
      1,
    );
  });

  it('fails closed when final-low scope or job input hash drifts from the trace manifest', async () => {
    const seeded = await seedSession(['嗯']);
    const runtime = createRuntime(new CountingProvider());
    await runtime.requestFinalFlush(seeded.sessionId);
    const job = await runtime.terminalJobForSession(seeded.sessionId);
    if (job === null) throw new Error('FINAL_LOW_JOB_REQUIRED');
    const trace = await prisma.decisionTrace.findFirstOrThrow({ where: { aiJobId: job.id } });
    const scope = await prisma.aiJobSessionScope.findFirstOrThrow({ where: { aiJobId: job.id } });
    await prisma.aiJobSessionScope.update({
      data: { segmentManifestHash: 'f'.repeat(64) },
      where: { id: scope.id },
    });
    await expect(traceReader.read(actorId, trace.id)).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
    await prisma.aiJobSessionScope.update({
      data: { segmentManifestHash: scope.segmentManifestHash },
      where: { id: scope.id },
    });
    await prisma.aiJob.update({ data: { inputHash: 'e'.repeat(64) }, where: { id: job.id } });
    await expect(traceReader.read(actorId, trace.id)).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
  });

  it('fails closed when final-low source membership is changed to overlap', async () => {
    const seeded = await seedSession(['嗯']);
    const runtime = createRuntime(new CountingProvider());
    await runtime.requestFinalFlush(seeded.sessionId);
    const job = await runtime.terminalJobForSession(seeded.sessionId);
    if (job === null) throw new Error('FINAL_LOW_JOB_REQUIRED');
    const trace = await prisma.decisionTrace.findFirstOrThrow({ where: { aiJobId: job.id } });
    await prisma.memoryMaintenanceInputSegment.updateMany({
      data: { membershipKind: 'overlap' },
      where: { aiJobId: job.id },
    });
    await expect(traceReader.read(actorId, trace.id)).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
  });

  it('fails closed when final-low has an extra persisted input segment', async () => {
    const seeded = await seedSession(['嗯']);
    const runtime = createRuntime(new CountingProvider());
    await runtime.requestFinalFlush(seeded.sessionId);
    const job = await runtime.terminalJobForSession(seeded.sessionId);
    if (job === null) throw new Error('FINAL_LOW_JOB_REQUIRED');
    const trace = await prisma.decisionTrace.findFirstOrThrow({ where: { aiJobId: job.id } });
    const extraSegmentId = await addSegment(seeded.sessionId, seeded.streamId, 1, '额外', 'elder');
    await prisma.aiJobInputSegment.create({
      data: {
        aiJobId: job.id,
        contentKind: 'conversation',
        effectiveTextDigest: effectiveTextDigest('额外'),
        id: randomUUID(),
        inputOrder: 1,
        roleAuthority: 'user_confirmed',
        sessionId: seeded.sessionId,
        speakerRoleRevision: 1,
        textRevision: 0,
        transcriptSegmentId: extraSegmentId,
        trustedEffectiveRole: 'elder',
      },
    });
    await expect(traceReader.read(actorId, trace.id)).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
  });

  it('fails closed when final-low has an extra session scope', async () => {
    const seeded = await seedSession(['嗯']);
    const runtime = createRuntime(new CountingProvider());
    await runtime.requestFinalFlush(seeded.sessionId);
    const job = await runtime.terminalJobForSession(seeded.sessionId);
    if (job === null) throw new Error('FINAL_LOW_JOB_REQUIRED');
    const trace = await prisma.decisionTrace.findFirstOrThrow({ where: { aiJobId: job.id } });
    const extraSession = await seedSession([]);
    await prisma.aiJobSessionScope.create({
      data: {
        aiJobId: job.id,
        eligibleSegmentCount: 0,
        id: randomUUID(),
        inputOrder: 1,
        maxSegmentId: null,
        maxSegmentStartMs: null,
        scopeReason: 'working_memory_maintain:system_rejection:elder',
        segmentManifestHash: manifestHash([]),
        sessionId: extraSession.sessionId,
        speakerRoleRevision: 1,
      },
    });
    await expect(traceReader.read(actorId, trace.id)).rejects.toThrow('DECISION_TRACE_UNAVAILABLE');
  });

  for (const orphanStatus of ['pending', 'running'] as const) {
    it(`startup terminalizes a fresh ${orphanStatus} v1.2 missing-trace orphan from durable facts`, async () => {
      const seeded = await seedSession(['嗯']);
      const segment = await prisma.transcriptSegment.findFirstOrThrow({
        where: { sessionId: seeded.sessionId },
      });
      const orphan = await jobs.freeze({
        actorId,
        contextBuilderVersion: 'memory-maintainer-v1.2',
        exactSegmentIds: [segment.id],
        expiresAt: new Date(clock.now().getTime() + 60_000),
        jobType: 'working_memory_maintain',
        projectId,
        requestId: randomUUID(),
        sessionIds: [seeded.sessionId],
        triggerDedupeKey: `memory-p1-v1.2:${seeded.sessionId}:fresh-${orphanStatus}`,
        trustedRole: 'elder',
        afterFreeze: async (tx, frozen) => {
          const input = frozen.segments[0];
          if (input === undefined) throw new Error('FRESH_ORPHAN_INPUT_REQUIRED');
          await tx.memoryMaintenanceInputSegment.create({
            data: {
              aiJobId: frozen.id,
              aiJobInputSegmentId: input.inputSegmentId,
              id: randomUUID(),
              inputOrder: 0,
              membershipKind: 'new',
              transcriptSegmentId: input.segmentId,
            },
          });
        },
      });
      if (orphanStatus === 'pending') {
        await prisma.aiJob.update({
          data: { status: 'pending', startedAt: null },
          where: { id: orphan.id },
        });
      }
      const firstProvider = new CountingProvider();
      const secondProvider = new CountingProvider();
      const recoveryConfig = { staleJobMs: 10 * 365 * 24 * 60 * 60 * 1_000 };
      await Promise.all([
        createRuntime(
          firstProvider,
          undefined,
          undefined,
          recoveryConfig,
        ).reconcilePersistedState(),
        createRuntime(
          secondProvider,
          undefined,
          undefined,
          recoveryConfig,
        ).reconcilePersistedState(),
      ]);
      expect(await prisma.aiJob.findUnique({ where: { id: orphan.id } })).toMatchObject({
        failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
        status: 'failed',
      });
      const recovered = await prisma.decisionTrace.findFirstOrThrow({
        include: { memoryTriggerObservation: true },
        where: { aiJobId: orphan.id },
      });
      expect(recovered).toMatchObject({
        errorCode: 'MEMORY_TRACE_PROVENANCE_UNAVAILABLE',
        stage: 'recovered',
        status: 'unavailable',
        memoryTriggerObservation: null,
      });
      expect(await prisma.decisionTrace.count({ where: { aiJobId: orphan.id } })).toBe(1);
      expect(
        [...firstProvider.contexts, ...secondProvider.contexts].some((context) =>
          context.transcript_membership.some(
            (membership) => membership.session_id === seeded.sessionId,
          ),
        ),
      ).toBe(false);
    });
  }

  it('keeps persisted v1.1 jobs and snapshots readable after the v1.2 cutover', async () => {
    const seeded = await seedSession([]);
    const triggerIdentity = `memory-p1-v1.1:${seeded.sessionId}:${'a'.repeat(40)}`;
    const job = await jobs.freeze({
      actorId,
      contextBuilderVersion: 'memory-maintainer-v1.1',
      exactSegmentIds: [],
      expiresAt: new Date(clock.now().getTime() + 60_000),
      jobType: 'working_memory_maintain',
      projectId,
      requestId: randomUUID(),
      sessionIds: [seeded.sessionId],
      triggerDedupeKey: triggerIdentity,
      trustedRole: 'elder',
    });
    const snapshotId = randomUUID();
    await jobs.writeBack(job, async (tx) => {
      await tx.memoryWorkingSnapshot.create({
        data: {
          aiJobId: job.id,
          boundaryManifestHash: manifestHash([]),
          contractVersion: 'memory-maintainer-v1.1',
          expectedBoundaryCount: 0,
          expectedResolutionCount: 0,
          expectedThreadCount: 0,
          id: snapshotId,
          policyRevision: job.policyRevision,
          projectId,
          resolutionManifestHash: manifestHash([]),
          sourceSessionId: seeded.sessionId,
          threadManifestHash: manifestHash([]),
          triggerIdentity,
          triggerKind: 'session_final_flush',
        },
      });
    });

    expect(
      await createRuntime(new CountingProvider()).terminalJobForSession(seeded.sessionId),
    ).toMatchObject({
      id: job.id,
      status: 'succeeded',
      triggerDedupeKey: triggerIdentity,
    });
    expect(await snapshots.readLatest(actorId, projectId, seeded.sessionId)).toMatchObject({
      boundaryIds: [],
      id: snapshotId,
      resolutionIds: [],
      threadIds: [],
    });
  });

  it('applies the provider-neutral operation matrix through one authority', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:matrix.base]=base']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
    await promoteCurrentMemoryToAcceptedFact(seeded.sessionId, 'matrix.base');
    const runtime = createRuntime(new MatrixProvider());
    for (const [index, operation] of [
      'DUPLICATE',
      'SUPPLEMENT',
      'UNCERTAIN',
      'BRANCH',
      'RELATED',
      'RESUME',
    ].entries()) {
      await addSegment(seeded.sessionId, seeded.streamId, index + 1, `矩阵:${operation}`, 'elder');
      await runtime.requestFinalFlush(seeded.sessionId);
    }
    expect(
      (await maintainerJobs(seeded.sessionId)).every(({ status }) => status === 'succeeded'),
    ).toBe(true);
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(7);
    expect(
      await prisma.memoryResolution.count({ where: { canonicalKey: 'matrix.base', projectId } }),
    ).toBe(3);
    expect(
      await prisma.memoryResolution.count({ where: { canonicalKey: 'matrix.branch', projectId } }),
    ).toBe(1);
    expect(
      await prisma.memoryResolution.count({ where: { canonicalKey: 'matrix.related', projectId } }),
    ).toBe(2);
  });

  for (const stage of [
    'during_writeback',
    'after_operations',
    'after_boundaries',
    'after_snapshot',
  ] as const) {
    it(`rolls back every business table when ${stage} fails`, async () => {
      const seeded = await seedSession([`工作记忆[episode:event:rollback-${stage}]=事务回滚`]);
      const runtime = createRuntime(
        new LocalTestMemoryMaintainerProvider(),
        new OneShotFailpoint(stage),
      );
      await expect(runtime.requestFinalFlush(seeded.sessionId)).rejects.toThrow(
        `FAILPOINT_${stage}`,
      );
      expect((await maintainerJobs(seeded.sessionId)).at(-1)?.status).toBe('failed');
      expect(await businessCounts(seeded.sessionId)).toEqual({
        boundaries: 0,
        claims: 0,
        consumptions: 0,
        resolutions: 0,
        snapshots: 0,
        threads: 0,
      });
      expect(await prisma.transcriptSegment.count({ where: { sessionId: seeded.sessionId } })).toBe(
        1,
      );
    });
  }

  for (const stage of ['before_freeze', 'after_freeze', 'after_provider'] as const) {
    it(`keeps transcript safe when crashing at ${stage}`, async () => {
      const seeded = await seedSession([`工作记忆[episode:event:crash-${stage}]=崩溃隔离`]);
      const runtime = createRuntime(
        new LocalTestMemoryMaintainerProvider(),
        new OneShotFailpoint(stage),
      );
      await expect(runtime.requestFinalFlush(seeded.sessionId)).rejects.toThrow(
        `FAILPOINT_${stage}`,
      );
      const attempt = (await maintainerJobs(seeded.sessionId)).at(-1);
      expect(attempt?.status ?? null).toBe(stage === 'before_freeze' ? null : 'running');
      expect(await businessCounts(seeded.sessionId)).toMatchObject({
        claims: 0,
        consumptions: 0,
        resolutions: 0,
        snapshots: 0,
      });
      expect(await prisma.transcriptSegment.count({ where: { sessionId: seeded.sessionId } })).toBe(
        1,
      );
      if (stage === 'after_freeze') {
        const frozen = await maintainerJobs(seeded.sessionId);
        if (frozen[0] === undefined) throw new Error('FROZEN_MEMORY_JOB_REQUIRED');
        expect(await prisma.decisionTrace.count({ where: { aiJobId: frozen[0].id } })).toBe(1);
      }
    });
  }

  it('repairs an after-freeze crash from persisted state without replaying the provider', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:atomic-restart]=事务后崩溃']);
    const crashed = createRuntime(new CountingProvider(), new OneShotFailpoint('after_freeze'));
    await expect(crashed.requestFinalFlush(seeded.sessionId)).rejects.toThrow(
      'FAILPOINT_after_freeze',
    );
    await crashed.requestFinalFlush(seeded.sessionId);
    const frozen = (await maintainerJobs(seeded.sessionId))[0];
    if (frozen === undefined) throw new Error('FROZEN_MEMORY_JOB_REQUIRED');
    expect(frozen).toMatchObject({ status: 'running' });
    expect(await prisma.decisionTrace.count({ where: { aiJobId: frozen.id } })).toBe(1);

    clock.advance(60_000);
    const firstProvider = new CountingProvider();
    const secondProvider = new CountingProvider();
    await Promise.all([
      createRuntime(firstProvider, undefined, undefined, {
        batchThreshold: 99,
        timeThresholdMs: 24 * 60 * 60 * 1_000,
      }).reconcilePersistedState(),
      createRuntime(secondProvider, undefined, undefined, {
        batchThreshold: 99,
        timeThresholdMs: 24 * 60 * 60 * 1_000,
      }).reconcilePersistedState(),
    ]);

    expect(await prisma.aiJob.findUnique({ where: { id: frozen.id } })).toMatchObject({
      failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
      status: 'failed',
    });
    expect(await prisma.decisionTrace.findFirst({ where: { aiJobId: frozen.id } })).toMatchObject({
      decisionOutcome: 'system_error',
      errorCode: 'SYSTEM_COORDINATOR_RESTARTED',
      stage: 'recovered',
      status: 'failed',
    });
    expect(
      [firstProvider, secondProvider]
        .flatMap(({ contexts }) => contexts)
        .some((context) =>
          context.transcript_membership.some(
            (membership) => membership.session_id === seeded.sessionId,
          ),
        ),
    ).toBe(false);
    expect(await businessCounts(seeded.sessionId)).toMatchObject({
      claims: 0,
      consumptions: 0,
      resolutions: 0,
      snapshots: 0,
    });
  });

  it('repairs a historical missing trace on module startup without inventing trigger facts', async () => {
    const seeded = await seedSession(['历史冻结输入']);
    const segment = await prisma.transcriptSegment.findFirstOrThrow({
      where: { sessionId: seeded.sessionId },
    });
    const triggerIdentity = `memory-p1-v1.2:${seeded.sessionId}:${'b'.repeat(40)}`;
    const historical = await jobs.freeze({
      actorId,
      contextBuilderVersion: 'memory-maintainer-v1.2',
      exactSegmentIds: [segment.id],
      expiresAt: new Date(clock.now().getTime() + 60_000),
      jobType: 'working_memory_maintain',
      projectId,
      requestId: randomUUID(),
      sessionIds: [seeded.sessionId],
      triggerDedupeKey: triggerIdentity,
      trustedRole: 'elder',
      afterFreeze: async (tx, frozen) => {
        const input = frozen.segments[0];
        if (input === undefined) throw new Error('HISTORICAL_INPUT_REQUIRED');
        await tx.memoryMaintenanceInputSegment.create({
          data: {
            aiJobId: frozen.id,
            aiJobInputSegmentId: input.inputSegmentId,
            id: randomUUID(),
            inputOrder: 0,
            membershipKind: 'new',
            transcriptSegmentId: input.segmentId,
          },
        });
      },
    });
    expect(await prisma.decisionTrace.count({ where: { aiJobId: historical.id } })).toBe(0);
    clock.advance(60_000);
    const firstProvider = new CountingProvider();
    const secondProvider = new CountingProvider();
    const config = {
      batchThreshold: 99,
      minimumUsefulCharacters: 999,
      timeThresholdMs: 24 * 60 * 60 * 1_000,
    };
    const firstRuntime = createRuntime(firstProvider, undefined, undefined, config);
    const secondRuntime = createRuntime(secondProvider, undefined, undefined, config);
    firstRuntime.onModuleInit();
    secondRuntime.onModuleInit();
    try {
      await vi.waitFor(
        async () => {
          expect(await prisma.aiJob.findUnique({ where: { id: historical.id } })).toMatchObject({
            failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
            status: 'failed',
          });
          expect(await prisma.decisionTrace.count({ where: { aiJobId: historical.id } })).toBe(1);
        },
        { interval: 20, timeout: 3_000 },
      );
    } finally {
      firstRuntime.onModuleDestroy();
      secondRuntime.onModuleDestroy();
    }
    const repaired = await prisma.decisionTrace.findFirstOrThrow({
      include: {
        memoryTriggerObservation: true,
        transcriptMemberships: true,
      },
      where: { aiJobId: historical.id },
    });
    expect(repaired).toMatchObject({
      errorCode: 'SYSTEM_COORDINATOR_RESTARTED',
      stage: 'recovered',
      status: 'failed',
      memoryTriggerObservation: null,
    });
    expect(repaired.transcriptMemberships).toEqual([
      expect.objectContaining({ segmentId: segment.id, textRevision: segment.textRevision }),
    ]);
    expect(
      [firstProvider, secondProvider]
        .flatMap(({ contexts }) => contexts)
        .some((context) =>
          context.transcript_membership.some(
            (membership) => membership.session_id === seeded.sessionId,
          ),
        ),
    ).toBe(false);
  });

  it('repairs a legacy empty-source final job without fabricating an empty observation', async () => {
    const seeded = await seedSession([]);
    const triggerIdentity = `memory-p1-v1.2:${seeded.sessionId}:final-unjudged:${decisionTraceMemoryTriggerManifest([]).slice(0, 32)}`;
    const legacy = await jobs.recordRejectedSystemJob(
      {
        actorId,
        contextBuilderVersion: 'memory-maintainer-v1.2',
        exactSegmentIds: [],
        expiresAt: new Date(clock.now().getTime() + 60_000),
        jobType: 'working_memory_maintain',
        projectId,
        requestId: randomUUID(),
        sessionIds: [seeded.sessionId],
        triggerDedupeKey: triggerIdentity,
        trustedRole: 'elder',
      },
      'MEMORY_UNJUDGED',
    );
    if (legacy === null) throw new Error('LEGACY_UNJUDGED_JOB_REQUIRED');
    await Promise.all([
      createRuntime(new CountingProvider()).reconcilePersistedState(),
      createRuntime(new CountingProvider()).reconcilePersistedState(),
    ]);
    const repaired = await prisma.decisionTrace.findFirstOrThrow({
      include: { memoryTriggerObservation: true },
      where: { aiJobId: legacy.id },
    });
    expect(repaired).toMatchObject({
      decisionOutcome: 'unavailable',
      errorCode: 'MEMORY_TRIGGER_PROVENANCE_UNAVAILABLE',
      memoryTriggerObservation: null,
      status: 'unavailable',
    });
    expect(await prisma.decisionTrace.count({ where: { aiJobId: legacy.id } })).toBe(1);
  });

  it('does not let more than 200 already-traced history rows starve a newer orphan', async () => {
    const seeded = await seedSession([]);
    const history = Array.from({ length: 201 }, (_, index) => {
      const id = randomUUID();
      return {
        id,
        requestId: randomUUID(),
        generationId: randomUUID(),
        triggerDedupeKey: `memory-p1-v1.2:${seeded.sessionId}:history-${String(index).padStart(3, '0')}`,
      };
    });
    await prisma.aiJob.createMany({
      data: history.map((item) => ({
        attemptNo: 1,
        completedAt: new Date('2029-01-01T00:00:00.000Z'),
        contextBuilderVersion: 'memory-maintainer-v1.2',
        createdAt: new Date('2029-01-01T00:00:00.000Z'),
        expiresAt: new Date('2031-01-01T00:00:00.000Z'),
        failureCode: null,
        id: item.id,
        inputHash: '1'.repeat(64),
        jobType: 'working_memory_maintain',
        modelName: 'provider-neutral-local-test',
        policyRevision: 1,
        projectId,
        promptVersion: 'memory-maintainer-v1.2',
        requestId: item.requestId,
        requestIdentityHash: sha256(`history:${item.id}`),
        requestedBy: actorId,
        retentionPolicyVersion: 1,
        schemaVersion: 'memory-maintainer-output-v1.2',
        startedAt: new Date('2029-01-01T00:00:00.000Z'),
        status: 'succeeded',
        triggerDedupeKey: item.triggerDedupeKey,
      })),
    });
    await prisma.decisionTrace.createMany({
      data: history.map((item) => ({
        aiJobId: item.id,
        completedAt: new Date('2029-01-01T00:00:00.001Z'),
        contextDigest: null,
        contextRevision: 0,
        decisionOutcome: 'continue_listening',
        directorInvoked: false,
        durationMs: 1,
        errorCode: null,
        expiresAt: new Date('2031-01-01T00:00:00.000Z'),
        generationId: item.generationId,
        id: randomUUID(),
        inputHash: '1'.repeat(64),
        ownerActorId: actorId,
        projectId,
        requestId: randomUUID(),
        sessionId: seeded.sessionId,
        stage: 'recovered',
        stageTimingsJson: { total: 1 },
        startedAt: new Date('2029-01-01T00:00:00.000Z'),
        status: 'succeeded',
        triggerType: 'working_memory_maintain',
        workingRevision: null,
      })),
    });
    const orphan = await jobs.recordRejectedSystemJob(
      {
        actorId,
        contextBuilderVersion: 'memory-maintainer-v1.2',
        exactSegmentIds: [],
        expiresAt: new Date(clock.now().getTime() + 60_000),
        jobType: 'working_memory_maintain',
        projectId,
        requestId: randomUUID(),
        sessionIds: [seeded.sessionId],
        triggerDedupeKey: `memory-p1-v1.2:${seeded.sessionId}:final-unjudged:${decisionTraceMemoryTriggerManifest([]).slice(0, 32)}`,
        trustedRole: 'elder',
      },
      'MEMORY_UNJUDGED',
    );
    if (orphan === null) throw new Error('STARVATION_ORPHAN_REQUIRED');
    await createRuntime(new CountingProvider()).reconcilePersistedState();
    expect(await prisma.decisionTrace.count({ where: { aiJobId: orphan.id } })).toBe(1);
  });

  it('does not rewrite a succeeded historical job when its trace is unavailable', async () => {
    const seeded = await seedSession(['历史成功输入']);
    const segment = await prisma.transcriptSegment.findFirstOrThrow({
      where: { sessionId: seeded.sessionId },
    });
    const historical = await jobs.freeze({
      actorId,
      contextBuilderVersion: 'memory-maintainer-v1.2',
      exactSegmentIds: [segment.id],
      expiresAt: new Date(clock.now().getTime() + 60_000),
      jobType: 'working_memory_maintain',
      projectId,
      requestId: randomUUID(),
      sessionIds: [seeded.sessionId],
      triggerDedupeKey: `memory-p1-v1.2:${seeded.sessionId}:${'c'.repeat(40)}`,
      trustedRole: 'elder',
    });
    await jobs.writeBack(historical, () => Promise.resolve());
    await createRuntime(new CountingProvider(), undefined, undefined, {
      batchThreshold: 99,
      minimumUsefulCharacters: 999,
      timeThresholdMs: 24 * 60 * 60 * 1_000,
    }).reconcilePersistedState();

    expect(await prisma.aiJob.findUnique({ where: { id: historical.id } })).toMatchObject({
      failureCode: null,
      status: 'succeeded',
    });
    expect(
      await prisma.decisionTrace.findFirst({ where: { aiJobId: historical.id } }),
    ).toMatchObject({
      decisionOutcome: 'unavailable',
      errorCode: 'MEMORY_TRACE_PROVENANCE_UNAVAILABLE',
      status: 'unavailable',
    });
  });

  it('terminalizes a stale provider-called missing-trace job without replaying the provider', async () => {
    const seeded = await seedSession(['历史供应商已调用输入']);
    const segment = await prisma.transcriptSegment.findFirstOrThrow({
      where: { sessionId: seeded.sessionId },
    });
    const historical = await jobs.freeze({
      actorId,
      contextBuilderVersion: 'memory-maintainer-v1.2',
      exactSegmentIds: [segment.id],
      expiresAt: new Date(clock.now().getTime() + 60_000),
      jobType: 'working_memory_maintain',
      projectId,
      requestId: randomUUID(),
      sessionIds: [seeded.sessionId],
      triggerDedupeKey: `memory-p1-v1.2:${seeded.sessionId}:${'d'.repeat(40)}`,
      trustedRole: 'elder',
    });
    await prisma.aiProviderCall.create({
      data: {
        aiJobId: historical.id,
        callKind: 'primary',
        callNo: 1,
        completedAt: new Date(),
        id: randomUUID(),
        inputHash: historical.inputHash,
        outputHash: 'e'.repeat(64),
        startedAt: new Date(),
        status: 'succeeded',
      },
    });
    clock.advance(60_000);
    const provider = new CountingProvider();
    await createRuntime(provider, undefined, undefined, {
      batchThreshold: 99,
      minimumUsefulCharacters: 999,
      timeThresholdMs: 24 * 60 * 60 * 1_000,
    }).reconcilePersistedState();

    expect(await prisma.aiJob.findUnique({ where: { id: historical.id } })).toMatchObject({
      failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
      status: 'failed',
    });
    expect(
      await prisma.decisionTrace.findFirst({ where: { aiJobId: historical.id } }),
    ).toMatchObject({
      decisionOutcome: 'system_error',
      errorCode: 'SYSTEM_COORDINATOR_RESTARTED',
      status: 'failed',
    });
    expect(
      provider.contexts.some((context) =>
        context.transcript_membership.some(
          (membership) => membership.session_id === seeded.sessionId,
        ),
      ),
    ).toBe(false);
  });

  it('keeps the committed batch authoritative when the process crashes after writeback', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:crash-after-writeback]=提交后崩溃']);
    const runtime = createRuntime(
      new LocalTestMemoryMaintainerProvider(),
      new OneShotFailpoint('after_writeback'),
    );
    await expect(runtime.requestFinalFlush(seeded.sessionId)).rejects.toThrow(
      'FAILPOINT_after_writeback',
    );
    expect((await maintainerJobs(seeded.sessionId)).at(-1)?.status).toBe('succeeded');
    expect(await businessCounts(seeded.sessionId)).toMatchObject({
      claims: 1,
      consumptions: 1,
      resolutions: 1,
      snapshots: 1,
    });
    await createRuntime(new LocalTestMemoryMaintainerProvider()).reconcilePersistedState();
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(1);
  });

  it('retains a failed attempt and creates a direct retry with the same identity', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:retry]=失败后重试']);
    const failpoint = new OneShotFailpoint('during_writeback');
    const runtime = createRuntime(new LocalTestMemoryMaintainerProvider(), failpoint);
    await expect(runtime.requestFinalFlush(seeded.sessionId)).rejects.toThrow(
      'FAILPOINT_during_writeback',
    );
    await runtime.requestFinalFlush(seeded.sessionId);
    const attempts = await maintainerJobs(seeded.sessionId);
    expect(attempts.map(({ attemptNo, status }) => [attemptNo, status])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
    expect(attempts[1]?.retryOfJobId).toBe(attempts[0]?.id);
    expect(attempts[1]?.triggerDedupeKey).toBe(attempts[0]?.triggerDedupeKey);
  });

  it('terminalizes a stale attempt once and fences its late callback', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:late]=迟到回调']);
    const provider = new DeferredProvider();
    const late = createRuntime(provider).requestFinalFlush(seeded.sessionId);
    await provider.waitUntilCalled();
    clock.advance(60_000);
    const recovery = createRuntime(new LocalTestMemoryMaintainerProvider());
    await recovery.reconcilePersistedState();
    provider.resolveNext();
    await expect(late).rejects.toThrow('AI_JOB_NOT_RUNNING');
    await recovery.reconcilePersistedState();
    const attempts = await maintainerJobs(seeded.sessionId);
    expect(attempts.map(({ attemptNo, status }) => [attemptNo, status])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
    expect(
      await prisma.memoryWorkingSnapshot.count({ where: { sourceSessionId: seeded.sessionId } }),
    ).toBe(1);
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(1);
  });

  it('fails closed on policy and transcript drift without damaging transcript rows', async () => {
    const policySession = await seedSession(['工作记忆[episode:event:policy]=策略漂移']);
    const policyProvider = new DeferredProvider();
    const policyRun = createRuntime(policyProvider).requestFinalFlush(policySession.sessionId);
    await policyProvider.waitUntilCalled();
    deletion.blockProject(projectId);
    policyProvider.resolveNext();
    await expect(policyRun).rejects.toThrow();
    deletion.clear();
    expect(await businessCounts(policySession.sessionId)).toMatchObject({
      consumptions: 0,
      snapshots: 0,
    });

    const deletionFenceSession = await seedSession([
      '工作记忆[episode:event:deletion-fence]=删除范围漂移',
    ]);
    const deletionFenceProvider = new DeferredProvider();
    const deletionFenceRun = createRuntime(deletionFenceProvider).requestFinalFlush(
      deletionFenceSession.sessionId,
    );
    await deletionFenceProvider.waitUntilCalled();
    deletion.setFenceRevision(2);
    deletionFenceProvider.resolveNext();
    await expect(deletionFenceRun).rejects.toThrow('MEMORY_GATE_AUTHORITY_SNAPSHOT_UNAVAILABLE');
    deletion.setFenceRevision(1);
    expect(await businessCounts(deletionFenceSession.sessionId)).toMatchObject({
      consumptions: 0,
      snapshots: 0,
    });

    const transcriptSession = await seedSession(['工作记忆[episode:event:revision]=证据漂移']);
    const transcriptProvider = new DeferredProvider();
    const transcriptRun = createRuntime(transcriptProvider).requestFinalFlush(
      transcriptSession.sessionId,
    );
    await transcriptProvider.waitUntilCalled();
    await prisma.transcriptSegment.updateMany({
      data: { correctedText: '正式修订后的虚构文本', textRevision: 1 },
      where: { sessionId: transcriptSession.sessionId },
    });
    transcriptProvider.resolveNext();
    await expect(transcriptRun).rejects.toThrow('AI_INPUT_DRIFT');
    expect(await businessCounts(transcriptSession.sessionId)).toMatchObject({
      consumptions: 0,
      snapshots: 0,
    });
    expect(
      await prisma.transcriptSegment.count({ where: { sessionId: transcriptSession.sessionId } }),
    ).toBe(1);

    const targetBase = await seedSession(['工作记忆[episode:event:target-base]=目标基线']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      targetBase.sessionId,
    );
    const target = await prisma.memoryResolution.findFirstOrThrow({
      where: { canonicalKey: 'target-base', projectId, status: 'current' },
    });
    const targetSession = await seedSession(['工作记忆[episode:event:target-next]=目标漂移']);
    const targetProvider = new DeferredProvider();
    const targetRun = createRuntime(targetProvider).requestFinalFlush(targetSession.sessionId);
    await targetProvider.waitUntilCalled();
    await prisma.memoryResolution.update({
      data: { status: 'superseded' },
      where: { id: target.id },
    });
    targetProvider.resolveNext();
    await expect(targetRun).rejects.toThrow('AI_MEMORY_INPUT_DRIFT');
    expect(await businessCounts(targetSession.sessionId)).toMatchObject({
      consumptions: 0,
      snapshots: 0,
    });
    await prisma.memoryResolution.update({ data: { status: 'current' }, where: { id: target.id } });
    await Promise.all([
      createRuntime(new LocalTestMemoryMaintainerProvider()).reconcilePersistedState(),
      createRuntime(new LocalTestMemoryMaintainerProvider()).reconcilePersistedState(),
      createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
        targetSession.sessionId,
      ),
    ]);
    const rebased = await maintainerJobs(targetSession.sessionId);
    expect(rebased.map(({ status }) => status).sort()).toEqual(['cancelled', 'succeeded']);
    expect(rebased.filter(({ status }) => status === 'succeeded')).toHaveLength(1);
    expect(rebased.find(({ status }) => status === 'succeeded')?.triggerDedupeKey).toMatch(
      /:rebase:[0-9a-f]{24}$/,
    );
    expect(
      await prisma.memoryWorkingConsumption.count({
        where: { sessionId: targetSession.sessionId },
      }),
    ).toBe(1);
  });

  it.each(['normal', 'disputed'] as const)(
    'enforces runtime target identity CAS against malicious %s output',
    async (mode) => {
      const base = await seedSession([`工作记忆[episode:event:cas-${mode}-base]=基线`]);
      await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
        base.sessionId,
      );
      const next = await seedSession([`恶意目标漂移:${mode}`]);
      const before = await prisma.memoryResolution.count({ where: { projectId } });
      await expect(
        createRuntime(
          new TargetIdentityDriftProvider(mode),
          new OneShotFailpoint(null),
          new BypassOutputValidator(),
        ).requestFinalFlush(next.sessionId),
      ).rejects.toThrow('MEMORY_TARGET_CAS_FAILED');
      expect(await prisma.memoryResolution.count({ where: { projectId } })).toBe(before);
      expect(await businessCounts(next.sessionId)).toMatchObject({
        claims: 0,
        consumptions: 0,
        resolutions: 0,
        snapshots: 0,
      });
    },
  );

  it('keeps the last complete snapshot visible while a newer writeback fails', async () => {
    const seeded = await seedSession(['工作记忆[episode:event:visible-old]=旧快照']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
    const previous = await snapshots.readLatest(actorId, projectId, seeded.sessionId);
    expect(previous).not.toBeNull();
    await addSegment(
      seeded.sessionId,
      seeded.streamId,
      1,
      '工作记忆[episode:event:failed-new]=失败新批',
      'elder',
    );
    const failing = createRuntime(
      new LocalTestMemoryMaintainerProvider(),
      new OneShotFailpoint('after_operations'),
    );
    await expect(failing.requestFinalFlush(seeded.sessionId)).rejects.toThrow(
      'FAILPOINT_after_operations',
    );
    expect((await snapshots.readLatest(actorId, projectId, seeded.sessionId))?.id).toBe(
      previous?.id,
    );
  });

  it('fails closed when ordinary boundary marker text reaches the runtime', async () => {
    const boundarySession = await seedSession(['访谈边界=不得继续的虚构范围']);
    await expect(
      createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
        boundarySession.sessionId,
      ),
    ).rejects.toThrow('BOUNDARY_EXPLICIT_INTENT_REQUIRED');
    expect(await businessCounts(boundarySession.sessionId)).toMatchObject({
      boundaries: 0,
      consumptions: 0,
      snapshots: 0,
    });
  });

  it('commits zero-delta consumption without inventing value rows', async () => {
    const seeded = await seedSession(['这是一段足够长但没有结构化记忆指令的虚构叙述。']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
    expect(await businessCounts(seeded.sessionId)).toEqual({
      boundaries: 0,
      claims: 0,
      consumptions: 1,
      resolutions: 0,
      snapshots: 1,
      threads: 0,
    });
    const job = (await maintainerJobs(seeded.sessionId)).at(-1);
    expect(job).toBeDefined();
    if (job === undefined) throw new Error('MEMORY_JOB_REQUIRED');
    await prisma.aiJob.update({
      data: { expiresAt: new Date(clock.now().getTime() - 1) },
      where: { id: job.id },
    });
    const cleanupRequestId = randomUUID();
    await retention.hideExpired('ai_job', job.id, cleanupRequestId, clock.now());
    expect(
      await prisma.memoryWorkingConsumption.findFirst({ where: { sessionId: seeded.sessionId } }),
    ).toMatchObject({ aiJobInputSegmentId: null, memoryWorkingSnapshotId: null });
    await retention.purge('ai_job', job.id, cleanupRequestId);
    expect(await prisma.aiJob.findUnique({ where: { id: job.id } })).toBeNull();
    await prisma.transcriptSegment.deleteMany({ where: { sessionId: seeded.sessionId } });
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(0);
  });

  it('detaches authority provenance across thread and session deletion without blocking cleanup', async () => {
    profileConfig.enabled = true;
    const seeded = await seedSession(['工作记忆[episode:event:delete-provenance]=删除邻接']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
    await promoteCurrentMemoryToAcceptedFact(seeded.sessionId, 'delete-provenance');
    const resolution = await prisma.memoryResolution.findFirstOrThrow({
      where: { canonicalKey: 'delete-provenance', projectId, status: 'current' },
    });
    const member = await prisma.memoryResolutionMember.findFirstOrThrow({
      where: { memoryResolutionId: resolution.id },
    });
    const claim = await prisma.memoryClaim.findUniqueOrThrow({
      where: { id: member.memoryClaimId },
    });
    const threadId = resolution.threadId;
    if (threadId === null) throw new Error('MEMORY_THREAD_REQUIRED');
    if (resolution.aiDerivedOutputId === null || claim.aiDerivedOutputId === null)
      throw new Error('MEMORY_DERIVED_OUTPUT_REQUIRED');
    expect(await eligibility.isMemoryResolutionEligible(actorId, projectId, resolution.id)).toBe(
      true,
    );
    expect(await eligibility.isEligible(actorId, resolution.aiDerivedOutputId)).toBe(true);
    expect(await eligibility.isEligible(actorId, claim.aiDerivedOutputId)).toBe(true);
    expect(
      (await currentMemory.list(actorId, projectId)).some(({ id }) => id === resolution.id),
    ).toBe(true);
    expect(
      (await currentMemory.list(actorId, projectId)).some(
        ({ canonicalKey }) => canonicalKey === 'legacy.sentinel',
      ),
    ).toBe(false);

    await prisma.memoryThread.delete({ where: { id: threadId } });
    expect(
      await prisma.memoryResolution.findUniqueOrThrow({ where: { id: resolution.id } }),
    ).toMatchObject({
      layer: 'working',
      provenanceState: 'detached_thread',
      semanticKind: 'fact',
      semanticStatus: 'current',
      sourceSessionId: seeded.sessionId,
      threadId: null,
    });
    expect(
      await prisma.memoryClaim.findUniqueOrThrow({ where: { id: member.memoryClaimId } }),
    ).toMatchObject({
      layer: 'working',
      provenanceState: 'detached_thread',
      semanticKind: 'fact',
      sourceSessionId: seeded.sessionId,
      threadId: null,
    });
    expect(await eligibility.isMemoryResolutionEligible(actorId, projectId, resolution.id)).toBe(
      false,
    );
    expect(await eligibility.isEligible(actorId, resolution.aiDerivedOutputId)).toBe(false);
    expect(await eligibility.isEligible(actorId, claim.aiDerivedOutputId)).toBe(false);
    expect(
      (await currentMemory.list(actorId, projectId)).some(({ id }) => id === resolution.id),
    ).toBe(false);
    const threadDetachedContextId = await contexts.create({
      actorId,
      consumerSessionId: seeded.sessionId,
      contextBuilderVersion: 'dev-008b2-opening-context-v2',
      expiresAt: new Date(clock.now().getTime() + 60_000),
      projectId,
      requestId: randomUUID(),
    });
    expect(
      await prisma.contextSnapshotMemory.count({
        where: { contextSnapshotId: threadDetachedContextId, memoryResolutionId: resolution.id },
      }),
    ).toBe(0);

    await prisma.aiJobSessionScope.deleteMany({ where: { sessionId: seeded.sessionId } });
    await prisma.aiJobInputSegment.deleteMany({ where: { sessionId: seeded.sessionId } });
    await prisma.interviewSession.delete({ where: { id: seeded.sessionId } });
    expect(
      await prisma.memoryResolution.findUniqueOrThrow({ where: { id: resolution.id } }),
    ).toMatchObject({
      provenanceState: 'detached_session_thread',
      sourceSessionId: null,
      threadId: null,
    });
    expect(
      await prisma.memoryClaim.findUniqueOrThrow({ where: { id: member.memoryClaimId } }),
    ).toMatchObject({
      provenanceState: 'detached_session_thread',
      sourceSessionId: null,
      threadId: null,
    });
    expect(
      (await currentMemory.list(actorId, projectId)).some(({ id }) => id === resolution.id),
    ).toBe(false);
    expect(await prisma.transcriptSegment.count({ where: { sessionId: seeded.sessionId } })).toBe(
      0,
    );

    const sessionOnly = await seedSession([
      '工作记忆[episode:event:delete-session-provenance]=仅删除会话',
    ]);
    const keeper = await seedSession([]);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      sessionOnly.sessionId,
    );
    const sessionResolution = await prisma.memoryResolution.findFirstOrThrow({
      where: { canonicalKey: 'delete-session-provenance', projectId, status: 'current' },
    });
    const sessionMember = await prisma.memoryResolutionMember.findFirstOrThrow({
      where: { memoryResolutionId: sessionResolution.id },
    });
    if (sessionResolution.threadId === null) throw new Error('MEMORY_THREAD_REQUIRED');
    await prisma.memoryThread.update({
      data: { originSessionId: keeper.sessionId },
      where: { id: sessionResolution.threadId },
    });
    expect(
      (await currentMemory.list(actorId, projectId)).some(({ id }) => id === sessionResolution.id),
    ).toBe(true);
    await prisma.aiJobSessionScope.deleteMany({ where: { sessionId: sessionOnly.sessionId } });
    await prisma.aiJobInputSegment.deleteMany({ where: { sessionId: sessionOnly.sessionId } });
    await prisma.interviewSession.delete({ where: { id: sessionOnly.sessionId } });
    expect(
      await prisma.memoryResolution.findUniqueOrThrow({ where: { id: sessionResolution.id } }),
    ).toMatchObject({
      provenanceState: 'detached_session',
      sourceSessionId: null,
      threadId: sessionResolution.threadId,
    });
    expect(
      await prisma.memoryClaim.findUniqueOrThrow({ where: { id: sessionMember.memoryClaimId } }),
    ).toMatchObject({
      provenanceState: 'detached_session',
      sourceSessionId: null,
      threadId: sessionResolution.threadId,
    });
    expect(
      await eligibility.isMemoryResolutionEligible(actorId, projectId, sessionResolution.id),
    ).toBe(false);
    expect(
      (await currentMemory.list(actorId, projectId)).some(({ id }) => id === sessionResolution.id),
    ).toBe(false);
    const sessionDetachedContextId = await contexts.create({
      actorId,
      consumerSessionId: keeper.sessionId,
      contextBuilderVersion: 'dev-008b2-opening-context-v2',
      expiresAt: new Date(clock.now().getTime() + 60_000),
      projectId,
      requestId: randomUUID(),
    });
    expect(
      await prisma.contextSnapshotMemory.count({
        where: {
          contextSnapshotId: sessionDetachedContextId,
          memoryResolutionId: sessionResolution.id,
        },
      }),
    ).toBe(0);
    expect(
      await prisma.contextSnapshotMemory.count({
        where: { contextSnapshotId: sessionDetachedContextId, memoryResolutionId: resolution.id },
      }),
    ).toBe(0);
    profileConfig.enabled = false;
  });

  function createRuntime(
    provider: MemoryMaintainerProvider,
    failpoint: MemoryMaintainerFailpoint = new OneShotFailpoint(null),
    outputValidator: MemoryMaintainerV12Validator = validator,
    config: Partial<MemoryMaintainerRuntimeConfig> = {},
  ): MemoryMaintainerRuntime {
    return new MemoryMaintainerRuntime(
      prisma,
      jobs,
      provider,
      outputValidator,
      traces,
      realtime,
      clock,
      failpoint,
      { ...runtimeConfig(), ...config },
      undefined,
      deletion,
    );
  }

  async function seedSession(
    texts: readonly string[],
  ): Promise<{ sessionId: string; streamId: string }> {
    sequenceNo += 1;
    const sessionId = randomUUID();
    const streamId = randomUUID();
    await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        id: sessionId,
        projectId,
        sequenceNo,
        speakerRoleRevision: 1,
        status: 'completed',
      },
    });
    await prisma.speakerStream.create({
      data: { closedAt: new Date(), id: streamId, sessionId, status: 'closed' },
    });
    for (const [index, text] of texts.entries())
      await addSegment(sessionId, streamId, index, text, 'elder');
    return { sessionId, streamId };
  }

  async function addSegment(
    sessionId: string,
    streamId: string,
    index: number,
    text: string,
    role: 'elder' | 'interviewer',
    contentKind: 'conversation' | 'speaker_calibration' = 'conversation',
  ): Promise<string> {
    const id = randomUUID();
    await prisma.transcriptSegment.create({
      data: {
        contentKind,
        createdAt: new Date('2029-12-31T23:00:00.000Z'),
        endMs: index * 1_000 + 900,
        id,
        ingestKey: `memory-runtime-${sessionId}-${String(index)}-${id}`,
        originalRoleAuthority: 'user_confirmed',
        originalSpeakerRole: role,
        originalText: text,
        sessionId,
        source: 'fixture',
        speakerRoleRevision: 1,
        speakerStreamId: streamId,
        startMs: index * 1_000,
        textRevision: 0,
      },
    });
    return id;
  }

  async function promoteCurrentMemoryToAcceptedFact(
    sessionId: string,
    canonicalKey: string,
  ): Promise<void> {
    const resolution = await prisma.memoryResolution.findFirstOrThrow({
      where: { canonicalKey, projectId, sourceSessionId: sessionId, status: 'current' },
    });
    const members = await prisma.memoryResolutionMember.findMany({
      select: { memoryClaimId: true },
      where: { memoryResolutionId: resolution.id },
    });
    await prisma.$transaction(async (tx) => {
      await tx.memoryClaim.updateMany({
        data: { semanticKind: 'fact' },
        where: { id: { in: members.map(({ memoryClaimId }) => memoryClaimId) } },
      });
      await tx.memoryResolution.update({
        data: { semanticKind: 'fact' },
        where: { id: resolution.id },
      });
    });
  }

  async function maintainerJobs(sessionId: string): Promise<AiJob[]> {
    const segmentIds = await sessionSegmentIds(sessionId);
    const inputs = await prisma.memoryMaintenanceInputSegment.findMany({
      select: { aiJobId: true },
      where: { transcriptSegmentId: { in: segmentIds } },
    });
    return prisma.aiJob.findMany({
      orderBy: [{ createdAt: 'asc' }, { attemptNo: 'asc' }],
      where: {
        id: { in: inputs.map(({ aiJobId }) => aiJobId) },
        jobType: 'working_memory_maintain',
      },
    });
  }

  async function sessionSegmentIds(sessionId: string): Promise<string[]> {
    return (
      await prisma.transcriptSegment.findMany({ select: { id: true }, where: { sessionId } })
    ).map(({ id }) => id);
  }

  async function businessCounts(sessionId: string): Promise<{
    boundaries: number;
    claims: number;
    consumptions: number;
    resolutions: number;
    snapshots: number;
    threads: number;
  }> {
    const jobIds = (await maintainerJobs(sessionId)).map(({ id }) => id);
    const [claims, resolutions, threads, boundaries, snapshots, consumptions] = await Promise.all([
      prisma.memoryClaim.count({ where: { sourceSessionId: sessionId } }),
      prisma.memoryResolution.count({ where: { sourceSessionId: sessionId } }),
      prisma.memoryThread.count({ where: { originSessionId: sessionId } }),
      prisma.memoryBoundaryRevision.count({ where: { aiJobId: { in: jobIds } } }),
      prisma.memoryWorkingSnapshot.count({ where: { sourceSessionId: sessionId } }),
      prisma.memoryWorkingConsumption.count({ where: { sessionId } }),
    ]);
    return { boundaries, claims, consumptions, resolutions, snapshots, threads };
  }
});

class ManualClock extends MemoryMaintainerClock {
  public constructor(private current: Date) {
    super();
  }
  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
  public override now(): Date {
    return new Date(this.current);
  }
}

class OneShotFailpoint extends MemoryMaintainerFailpoint {
  public constructor(private stage: MemoryMaintainerFailpointStage | null) {
    super();
  }
  public override hit(stage: MemoryMaintainerFailpointStage): Promise<void> {
    if (stage !== this.stage) return Promise.resolve();
    this.stage = null;
    return Promise.reject(new Error(`FAILPOINT_${stage}`));
  }
}

class DeferredProvider extends MemoryMaintainerProvider {
  public callCount = 0;
  private pending: null | {
    context: MemoryMaintainerContextV12;
    reject: (error: Error) => void;
    resolve: (output: MemoryMaintainerOutputV12) => void;
  } = null;
  private readonly local = new LocalTestMemoryMaintainerProvider();
  private readonly calledPromise: Promise<void>;
  private signalCalled: () => void = () => undefined;

  public constructor() {
    super();
    this.calledPromise = new Promise((resolve) => {
      this.signalCalled = resolve;
    });
  }
  public override maintain(
    context: MemoryMaintainerContextV12,
  ): Promise<MemoryMaintainerOutputV12> {
    this.callCount += 1;
    return new Promise((resolve, reject) => {
      this.pending = { context, reject, resolve };
      this.signalCalled();
    });
  }
  public resolveNext(): void {
    const pending = this.pending;
    if (pending === null) throw new Error('DEFERRED_PROVIDER_NOT_PENDING');
    this.pending = null;
    void this.local.maintain(pending.context).then(pending.resolve, pending.reject);
  }
  public waitUntilCalled(): Promise<void> {
    return this.calledPromise;
  }
}

class CountingProvider extends MemoryMaintainerProvider {
  public callCount = 0;
  public readonly contexts: MemoryMaintainerContextV12[] = [];
  public override maintain(
    context: MemoryMaintainerContextV12,
  ): Promise<MemoryMaintainerOutputV12> {
    this.callCount += 1;
    this.contexts.push(context);
    return Promise.resolve({
      boundary_candidates: [],
      operations: [],
      output_schema_version: 'memory-maintainer-output-v1.2',
    });
  }
}

class BypassOutputValidator extends MemoryMaintainerV12Validator {
  public override validateOutput(
    _context: MemoryMaintainerContextV12,
    value: unknown,
  ): MemoryMaintainerOutputV12 {
    return value as MemoryMaintainerOutputV12;
  }
}

class TargetIdentityDriftProvider extends MemoryMaintainerProvider {
  public constructor(private readonly mode: 'normal' | 'disputed') {
    super();
  }

  public override maintain(
    context: MemoryMaintainerContextV12,
  ): Promise<MemoryMaintainerOutputV12> {
    const target = context.current_working_memory.at(-1);
    const segment = context.transcript_membership.find(
      ({ membership_kind }) => membership_kind === 'new',
    );
    if (target === undefined || segment === undefined)
      throw new Error('MALICIOUS_TARGET_FIXTURE_REQUIRED');
    const disputed = this.mode === 'disputed';
    return Promise.resolve({
      boundary_candidates: [],
      operations: [
        {
          anchor_thread_id: disputed ? randomUUID() : target.thread_id,
          evidence_segment_ids: [segment.segment_id],
          expected_anchor_thread_revision: context.active_thread?.revision ?? 1,
          expected_resolution_revision: target.revision,
          kind: 'SUPPLEMENT',
          operation_id: `malicious:${this.mode}:${segment.segment_id}`,
          proposed_state: {
            canonical_key: disputed ? target.canonical_key : `${target.canonical_key}.drift`,
            claims: disputed
              ? [
                  {
                    claim_id: target.claims[0]?.claim_id ?? null,
                    claim_key: 'malicious-disputed-a',
                    evidence_segment_ids: [segment.segment_id],
                    value: 'a',
                    value_kind: 'exact',
                  },
                  {
                    claim_id: target.claims[0]?.claim_id ?? null,
                    claim_key: 'malicious-disputed-b',
                    evidence_segment_ids: [segment.segment_id],
                    value: 'b',
                    value_kind: 'exact',
                  },
                ]
              : [
                  {
                    claim_id: null,
                    claim_key: 'malicious-normal',
                    evidence_segment_ids: [segment.segment_id],
                    value: 'drift',
                    value_kind: 'exact',
                  },
                ],
            memory_tag: target.memory_tag ?? null,
            resolution_kind: disputed ? 'conflict_set' : 'single',
            semantic_kind: target.semantic_kind,
            semantic_status: disputed ? 'disputed' : 'current',
            value: disputed ? null : 'drift',
            value_kind: disputed ? null : 'exact',
          },
          reason_code: disputed ? 'conflicting_claims' : 'explicit_correction',
          target_resolution_id: target.resolution_id,
        },
      ],
      output_schema_version: 'memory-maintainer-output-v1.2',
    });
  }
}

class TagChangeProvider extends MemoryMaintainerProvider {
  public override maintain(
    context: MemoryMaintainerContextV12,
  ): Promise<MemoryMaintainerOutputV12> {
    const target = context.current_working_memory.find(
      ({ canonical_key }) => canonical_key === 'tag.optional',
    );
    const segment = context.transcript_membership.find(
      ({ membership_kind }) => membership_kind === 'new',
    );
    if (target === undefined || segment === undefined) throw new Error('TAG_CHANGE_INPUT_REQUIRED');
    return Promise.resolve({
      boundary_candidates: [],
      operations: [
        {
          anchor_thread_id: target.thread_id,
          evidence_segment_ids: [segment.segment_id],
          expected_anchor_thread_revision: context.active_thread?.revision ?? 1,
          expected_resolution_revision: target.revision,
          kind: 'SUPPLEMENT',
          operation_id: `tag-change:${segment.segment_id}`,
          proposed_state: {
            canonical_key: target.canonical_key,
            claims: [
              {
                claim_id: null,
                claim_key: `tag-change:${segment.segment_id}`,
                evidence_segment_ids: [segment.segment_id],
                value: 'updated',
                value_kind: 'exact',
              },
            ],
            memory_tag: 'event',
            resolution_kind: 'single',
            semantic_kind: target.semantic_kind,
            semantic_status: 'current',
            value: 'updated',
            value_kind: 'exact',
          },
          reason_code: 'explicit_correction',
          target_resolution_id: target.resolution_id,
        },
      ],
      output_schema_version: 'memory-maintainer-output-v1.2',
    });
  }
}

class OrdinaryFactProvider extends MemoryMaintainerProvider {
  public constructor(private readonly kind: 'NEW' | 'BRANCH' | 'RELATED' = 'NEW') {
    super();
  }

  public override maintain(
    context: MemoryMaintainerContextV12,
  ): Promise<MemoryMaintainerOutputV12> {
    const segment = context.transcript_membership.find(
      ({ membership_kind }) => membership_kind === 'new',
    );
    if (segment === undefined) throw new Error('ORDINARY_FACT_INPUT_REQUIRED');
    return Promise.resolve({
      boundary_candidates: [],
      operations: [
        {
          anchor_thread_id: this.kind === 'NEW' ? null : (context.active_thread?.thread_id ?? null),
          evidence_segment_ids: [segment.segment_id],
          expected_anchor_thread_revision:
            this.kind === 'NEW' ? null : (context.active_thread?.revision ?? null),
          expected_resolution_revision: null,
          kind: this.kind,
          operation_id: `ordinary-${this.kind.toLowerCase()}:${segment.segment_id}`,
          proposed_state: {
            canonical_key: `ordinary.${this.kind.toLowerCase()}`,
            claims: [
              {
                claim_id: null,
                claim_key: 'ordinary-fact',
                evidence_segment_ids: [segment.segment_id],
                value: 'ordinary',
                value_kind: 'exact',
              },
            ],
            memory_tag: 'event',
            resolution_kind: 'single',
            semantic_kind: 'fact',
            semantic_status: 'current',
            value: 'ordinary',
            value_kind: 'exact',
          },
          reason_code: 'new_topic',
          target_resolution_id: null,
        },
      ],
      output_schema_version: 'memory-maintainer-output-v1.2',
    });
  }
}

class MatrixProvider extends MemoryMaintainerProvider {
  public override maintain(
    context: MemoryMaintainerContextV12,
  ): Promise<MemoryMaintainerOutputV12> {
    const segment = [...context.transcript_membership]
      .reverse()
      .find(({ membership_kind }) => membership_kind === 'new');
    if (segment === undefined) throw new Error('MATRIX_NEW_SEGMENT_REQUIRED');
    const kind = segment.text.replace('矩阵:', '') as
      'DUPLICATE' | 'SUPPLEMENT' | 'UNCERTAIN' | 'BRANCH' | 'RELATED' | 'RESUME';
    const targetKey = kind === 'RESUME' ? 'matrix.related' : 'matrix.base';
    const target = context.current_working_memory.find(
      ({ canonical_key }) => canonical_key === targetKey,
    );
    const creates = kind === 'BRANCH' || kind === 'RELATED';
    if (!creates && target === undefined) throw new Error('MATRIX_TARGET_REQUIRED');
    const canonicalKey =
      kind === 'BRANCH' ? 'matrix.branch' : kind === 'RELATED' ? 'matrix.related' : targetKey;
    const uncertain = kind === 'UNCERTAIN';
    return Promise.resolve({
      boundary_candidates: [],
      operations: [
        {
          anchor_thread_id: creates
            ? (context.active_thread?.thread_id ?? null)
            : (target?.thread_id ?? null),
          evidence_segment_ids: [segment.segment_id],
          expected_anchor_thread_revision: context.active_thread?.revision ?? null,
          expected_resolution_revision: creates ? null : (target?.revision ?? null),
          kind,
          operation_id: `matrix:${kind}:${segment.segment_id}`,
          proposed_state:
            kind === 'DUPLICATE'
              ? null
              : {
                  canonical_key: canonicalKey,
                  claims: [
                    {
                      claim_id: null,
                      claim_key: `matrix-claim:${segment.segment_id}`,
                      evidence_segment_ids: [segment.segment_id],
                      value: uncertain ? 'unknown' : kind.toLowerCase(),
                      value_kind: uncertain ? 'unknown' : 'exact',
                    },
                  ],
                  memory_tag: 'event',
                  resolution_kind: uncertain ? 'unknown' : 'single',
                  semantic_kind: creates ? 'episode' : 'fact',
                  semantic_status: uncertain ? 'uncertain' : 'current',
                  value: uncertain ? 'unknown' : kind.toLowerCase(),
                  value_kind: uncertain ? 'unknown' : 'exact',
                },
          reason_code:
            kind === 'DUPLICATE'
              ? 'duplicate_content'
              : kind === 'SUPPLEMENT'
                ? 'explicit_correction'
                : kind === 'UNCERTAIN'
                  ? 'uncertain_value'
                  : kind === 'BRANCH'
                    ? 'new_topic'
                    : 'same_topic',
          target_resolution_id: creates ? null : (target?.resolution_id ?? null),
        },
      ],
      output_schema_version: 'memory-maintainer-output-v1.2',
    });
  }
}

function runtimeConfig(): MemoryMaintainerRuntimeConfig {
  return {
    batchThreshold: 2,
    contractMerged: true,
    contractReviewStatus: 'pass',
    enabled: true,
    legacyMemoryExtractEnabled: false,
    loadedContractVersion: 'memory-maintainer-v1.2',
    minimumUsefulCharacters: 2,
    overlapSegments: 2,
    postSessionMemoryLane: 'delegate_p1_final_flush',
    providerDeadlineMs: 60_000,
    scanIntervalMs: 60_000,
    staleJobMs: 30_000,
    timeThresholdMs: 30_000,
    unconsumedFinalAuthority: 'p1',
  };
}
