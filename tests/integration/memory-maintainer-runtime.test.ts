import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiJobCoordinatorService } from '../../apps/api/src/ai-runtime/ai-job-coordinator.service.js';
import { AiRetentionService } from '../../apps/api/src/ai-runtime/ai-retention.service.js';
import { DecisionTraceService } from '../../apps/api/src/ai-runtime/decision-trace.service.js';
import { LocalTestDeletionScopeFixtureReader } from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import type { AiJob } from '../../apps/api/src/generated/prisma/client.js';
import {
  LocalTestMemoryMaintainerProvider,
  MemoryMaintainerProvider,
  type MemoryMaintainerContextV11,
  type MemoryMaintainerOutputV11,
} from '../../apps/api/src/memory/memory-maintainer.provider.js';
import {
  MemoryMaintainerClock,
  MemoryMaintainerFailpoint,
  type MemoryMaintainerFailpointStage,
  MemoryMaintainerRuntime,
  type MemoryMaintainerRuntimeConfig,
} from '../../apps/api/src/memory/memory-maintainer.runtime.js';
import { MemoryMaintainerV11Validator } from '../../apps/api/src/memory/memory-maintainer.validator.js';
import { MemoryWorkingSnapshotReader } from '../../apps/api/src/memory/memory-working-snapshot.reader.js';
import { RealtimeRuntimeService } from '../../apps/api/src/realtime-transcription/realtime-runtime.service.js';

describe('MEMORY-T2-T4-RUNTIME-001 PostgreSQL runtime and recovery', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobs: AiJobCoordinatorService;
  let retention: AiRetentionService;
  let traces: DecisionTraceService;
  let realtime: RealtimeRuntimeService;
  let validator: MemoryMaintainerV11Validator;
  let deletion: LocalTestDeletionScopeFixtureReader;
  let snapshots: MemoryWorkingSnapshotReader;

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
    retention = app.get(AiRetentionService);
    traces = app.get(DecisionTraceService);
    realtime = app.get(RealtimeRuntimeService);
    validator = app.get(MemoryMaintainerV11Validator);
    deletion = app.get(LocalTestDeletionScopeFixtureReader);
    snapshots = app.get(MemoryWorkingSnapshotReader);
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
    const first = await seedSession(['工作记忆[fact:event:first]=第一段']);
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
  });

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
    const seeded = await seedSession(['工作记忆[fact:event:legacy-check]=不读取旧 sentinel']);
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
    const seeded = await seedSession(['工作记忆[fact:event:concurrent]=并发通知']);
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
    const seeded = await seedSession(['工作记忆[fact:event:lost-notice]=丢通知']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).reconcilePersistedState();
    expect(
      await prisma.memoryWorkingConsumption.count({ where: { sessionId: seeded.sessionId } }),
    ).toBe(1);
  });

  it('projects an unjudged terminal final flush without calling the provider', async () => {
    const seeded = await seedSession(['嗯']);
    const provider = new CountingProvider();
    const runtime = createRuntime(provider);
    await runtime.requestFinalFlush(seeded.sessionId);
    expect(provider.callCount).toBe(0);
    expect(await runtime.terminalJobForSession(seeded.sessionId)).toMatchObject({
      failureCode: 'MEMORY_UNJUDGED',
      status: 'cancelled',
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

  it('applies the provider-neutral operation matrix through one authority', async () => {
    const seeded = await seedSession(['工作记忆[fact:event:matrix.base]=base']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
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
      const seeded = await seedSession([
        `工作记忆[fact:event:rollback-${stage}]=事务回滚`,
        '访谈边界=虚构边界',
      ]);
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
        2,
      );
    });
  }

  for (const stage of ['before_freeze', 'after_freeze', 'after_provider'] as const) {
    it(`keeps transcript safe when crashing at ${stage}`, async () => {
      const seeded = await seedSession([`工作记忆[fact:event:crash-${stage}]=崩溃隔离`]);
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
    });
  }

  it('keeps the committed batch authoritative when the process crashes after writeback', async () => {
    const seeded = await seedSession(['工作记忆[fact:event:crash-after-writeback]=提交后崩溃']);
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
    const seeded = await seedSession(['工作记忆[fact:event:retry]=失败后重试']);
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
    const seeded = await seedSession(['工作记忆[fact:event:late]=迟到回调']);
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
    const policySession = await seedSession(['工作记忆[fact:event:policy]=策略漂移']);
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

    const transcriptSession = await seedSession(['工作记忆[fact:event:revision]=证据漂移']);
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

    const targetBase = await seedSession(['工作记忆[fact:event:target-base]=目标基线']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      targetBase.sessionId,
    );
    const target = await prisma.memoryResolution.findFirstOrThrow({
      where: { canonicalKey: 'target-base', projectId, status: 'current' },
    });
    const targetSession = await seedSession(['工作记忆[fact:event:target-next]=目标漂移']);
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
      const base = await seedSession([`工作记忆[fact:event:cas-${mode}-base]=基线`]);
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
    const seeded = await seedSession(['工作记忆[fact:event:visible-old]=旧快照']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
    const previous = await snapshots.readLatest(actorId, projectId, seeded.sessionId);
    expect(previous).not.toBeNull();
    await addSegment(
      seeded.sessionId,
      seeded.streamId,
      1,
      '工作记忆[fact:event:failed-new]=失败新批',
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

  it('rejects boundary revision drift after provider return', async () => {
    const boundarySession = await seedSession(['访谈边界=不得继续的虚构范围']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      boundarySession.sessionId,
    );
    const boundaryIds = (
      await prisma.memoryBoundary.findMany({ select: { id: true }, where: { projectId } })
    ).map(({ id }) => id);
    const boundary = await prisma.memoryBoundaryRevision.findFirstOrThrow({
      where: { boundaryId: { in: boundaryIds }, status: 'active', supersededAt: null },
    });
    const next = await seedSession(['工作记忆[fact:event:boundary-drift]=边界漂移']);
    const provider = new DeferredProvider();
    const running = createRuntime(provider).requestFinalFlush(next.sessionId);
    await provider.waitUntilCalled();
    await prisma.memoryBoundaryRevision.update({
      data: { status: 'revoked' },
      where: { id: boundary.id },
    });
    provider.resolveNext();
    await expect(running).rejects.toThrow('MEMORY_BOUNDARY_CONTEXT_DRIFT');
    await prisma.memoryBoundaryRevision.update({
      data: { status: 'active' },
      where: { id: boundary.id },
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
    const seeded = await seedSession(['工作记忆[fact:event:delete-provenance]=删除邻接']);
    await createRuntime(new LocalTestMemoryMaintainerProvider()).requestFinalFlush(
      seeded.sessionId,
    );
    const resolution = await prisma.memoryResolution.findFirstOrThrow({
      where: { canonicalKey: 'delete-provenance', projectId, status: 'current' },
    });
    const member = await prisma.memoryResolutionMember.findFirstOrThrow({
      where: { memoryResolutionId: resolution.id },
    });
    const threadId = resolution.threadId;
    if (threadId === null) throw new Error('MEMORY_THREAD_REQUIRED');

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
    expect(await prisma.transcriptSegment.count({ where: { sessionId: seeded.sessionId } })).toBe(
      0,
    );
  });

  function createRuntime(
    provider: MemoryMaintainerProvider,
    failpoint: MemoryMaintainerFailpoint = new OneShotFailpoint(null),
    outputValidator: MemoryMaintainerV11Validator = validator,
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
      runtimeConfig(),
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
  ): Promise<string> {
    const id = randomUUID();
    await prisma.transcriptSegment.create({
      data: {
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

  async function maintainerJobs(sessionId: string): Promise<AiJob[]> {
    const segmentIds = (
      await prisma.transcriptSegment.findMany({ select: { id: true }, where: { sessionId } })
    ).map(({ id }) => id);
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
    context: MemoryMaintainerContextV11;
    reject: (error: Error) => void;
    resolve: (output: MemoryMaintainerOutputV11) => void;
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
    context: MemoryMaintainerContextV11,
  ): Promise<MemoryMaintainerOutputV11> {
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
  public override maintain(): Promise<MemoryMaintainerOutputV11> {
    this.callCount += 1;
    return Promise.resolve({
      boundary_candidates: [],
      operations: [],
      output_schema_version: 'memory-maintainer-output-v1.1',
    });
  }
}

class BypassOutputValidator extends MemoryMaintainerV11Validator {
  public override validateOutput(
    _context: MemoryMaintainerContextV11,
    value: unknown,
  ): MemoryMaintainerOutputV11 {
    return value as MemoryMaintainerOutputV11;
  }
}

class TargetIdentityDriftProvider extends MemoryMaintainerProvider {
  public constructor(private readonly mode: 'normal' | 'disputed') {
    super();
  }

  public override maintain(
    context: MemoryMaintainerContextV11,
  ): Promise<MemoryMaintainerOutputV11> {
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
            memory_type: target.memory_type,
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
      output_schema_version: 'memory-maintainer-output-v1.1',
    });
  }
}

class MatrixProvider extends MemoryMaintainerProvider {
  public override maintain(
    context: MemoryMaintainerContextV11,
  ): Promise<MemoryMaintainerOutputV11> {
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
                  memory_type: 'event',
                  resolution_kind: uncertain ? 'unknown' : 'single',
                  semantic_kind: 'fact',
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
      output_schema_version: 'memory-maintainer-output-v1.1',
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
    loadedContractVersion: 'memory-maintainer-v1.1',
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
