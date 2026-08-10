import { createHmac, randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiOutputEligibilityService } from '../../apps/api/src/ai-runtime/ai-output-eligibility.service.js';
import { AiJobCoordinatorService } from '../../apps/api/src/ai-runtime/ai-job-coordinator.service.js';
import { EMPTY_MANIFEST_HASH, sha256 } from '../../apps/api/src/ai-runtime/ai-provenance.js';
import { AiRetentionService } from '../../apps/api/src/ai-runtime/ai-retention.service.js';
import { LocalTestDeletionScopeFixtureReader } from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import { LocalTestBoundaryPolicyFixtureReader } from '../../apps/api/src/ai-runtime/ai-policy.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import type { QuestionDisplaySnapshot } from '../../apps/api/src/generated/prisma/client.js';
import { InterviewContextService } from '../../apps/api/src/memory/interview-context.service.js';
import { CurrentMemoryReader, MemoryService } from '../../apps/api/src/memory/memory.service.js';
import {
  ActualAskedReader,
  QuestionEvidenceService,
} from '../../apps/api/src/question-evidence/question-evidence.service.js';
import { normalizeQuestionDigest } from '../../apps/api/src/question-evidence/question-similarity.matcher.js';

describe('DEV-006 structured memory and QuestionEvidence PostgreSQL seam', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let memory: MemoryService;
  let currentMemory: CurrentMemoryReader;
  let questionEvidence: QuestionEvidenceService;
  let actualAsked: ActualAskedReader;
  let context: InterviewContextService;
  let retention: AiRetentionService;
  let deletionFixture: LocalTestDeletionScopeFixtureReader;
  let eligibility: AiOutputEligibilityService;
  let coordinator: AiJobCoordinatorService;
  let boundaryFixture: LocalTestBoundaryPolicyFixtureReader;

  const actorId = randomUUID();
  const projectId = randomUUID();
  const firstSessionId = randomUUID();
  const secondSessionId = randomUUID();
  const emptySessionId = randomUUID();
  const ineligibleSessionId = randomUUID();

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-dev-006-policy-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-dev-006-retention-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    memory = app.get(MemoryService);
    currentMemory = app.get(CurrentMemoryReader);
    questionEvidence = app.get(QuestionEvidenceService);
    actualAsked = app.get(ActualAskedReader);
    context = app.get(InterviewContextService);
    retention = app.get(AiRetentionService);
    deletionFixture = app.get(LocalTestDeletionScopeFixtureReader);
    eligibility = app.get(AiOutputEligibilityService);
    coordinator = app.get(AiJobCoordinatorService);
    boundaryFixture = app.get(LocalTestBoundaryPolicyFixtureReader);

    await prisma.user.create({
      data: {
        displayName: 'Fictional listener DEV-006',
        email: `dev-006-${actorId}@example.test`,
        id: actorId,
        passwordHash: 'test-only',
        role: 'interviewer',
      },
    });
    await prisma.elderProject.create({
      data: { createdBy: actorId, displayName: 'Fictional elder', id: projectId, status: 'active' },
    });
    await prisma.projectAssignment.create({ data: { projectId, userId: actorId } });
    await prisma.consentRecord.create({
      data: {
        consentMethod: 'electronic',
        consentTextVersion: 'fictional-v1',
        consentType: 'recording_transcription_ai',
        consentedAt: new Date(),
        createdBy: actorId,
        projectId,
        status: 'valid',
      },
    });
    await prisma.interviewSession.createMany({
      data: [
        { createdBy: actorId, id: firstSessionId, projectId, sequenceNo: 1, status: 'completed' },
        { createdBy: actorId, id: secondSessionId, projectId, sequenceNo: 2, status: 'completed' },
        { createdBy: actorId, id: emptySessionId, projectId, sequenceNo: 3, status: 'completed' },
        {
          createdBy: actorId,
          id: ineligibleSessionId,
          projectId,
          sequenceNo: 4,
          status: 'completed',
        },
      ],
    });
    await seedSession(firstSessionId, 1, [
      { role: 'elder', text: '记忆[place:故乡]=苏州' },
      { role: 'interviewer', text: '您小时候住在哪里？' },
    ]);
    await seedSession(secondSessionId, 2, [
      { role: 'elder', text: '记忆[place:故乡]=杭州' },
      { role: 'elder', text: '更正记忆[place:故乡]=无锡' },
    ]);
    await seedSession(ineligibleSessionId, 4, [
      { role: 'interviewer', text: '这是一个只有倾听员 final 的虚构会话。' },
    ]);
  });

  afterAll(async () => {
    deletionFixture.clear();
    boundaryFixture.clear();
    await prisma.aiRetentionCleanupAudit.deleteMany({
      where: { rootIdHash: { not: '' } },
    });
    await prisma.memoryResolutionMember.deleteMany();
    await prisma.contextSnapshotMemory.deleteMany();
    await prisma.contextSnapshotActualQuestion.deleteMany();
    await prisma.aiJob.deleteMany({ where: { projectId } });
    await prisma.questionDisplaySnapshot.deleteMany({
      where: {
        sessionId: { in: [firstSessionId, secondSessionId, emptySessionId, ineligibleSessionId] },
      },
    });
    await prisma.memoryRetentionRoot.deleteMany({ where: { projectId } });
    await prisma.sessionFinalization.deleteMany({
      where: {
        sessionId: { in: [firstSessionId, secondSessionId, emptySessionId, ineligibleSessionId] },
      },
    });
    await prisma.transcriptSegment.deleteMany({
      where: {
        sessionId: { in: [firstSessionId, secondSessionId, emptySessionId, ineligibleSessionId] },
      },
    });
    await prisma.speakerStream.deleteMany({
      where: {
        sessionId: { in: [firstSessionId, secondSessionId, emptySessionId, ineligibleSessionId] },
      },
    });
    await prisma.audioObject.deleteMany({ where: { projectId } });
    await prisma.interviewSession.deleteMany({ where: { projectId } });
    await prisma.consentRecord.deleteMany({ where: { projectId } });
    await prisma.projectAssignment.deleteMany({ where: { projectId } });
    await prisma.elderProject.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await app.close();
  });

  it('runs trusted finals through current memory, reliable actual catalog and cross-session context', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    await memory.extract({
      actorId,
      expiresAt,
      projectId,
      requestId: randomUUID(),
      sessionIds: [firstSessionId],
    });
    await memory.extract({
      actorId,
      expiresAt,
      projectId,
      requestId: randomUUID(),
      sessionIds: [secondSessionId],
    });
    const current = await currentMemory.list(actorId, projectId);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      canonicalKey: '故乡',
      resolutionKind: 'single',
      resolutionRevision: 3,
      resolvedValue: { value: '无锡' },
    });
    expect(
      await prisma.memoryResolution.count({
        where: { canonicalKey: '故乡', projectId, resolutionKind: 'conflict_set' },
      }),
    ).toBe(1);
    expect(await prisma.memoryClaimEvidence.count()).toBeGreaterThan(0);

    const analysis = await questionEvidence.reconcileActualQuestions({
      actorId,
      expiresAt,
      projectId,
      requestId: randomUUID(),
      sessionId: firstSessionId,
    });
    expect(analysis).toMatchObject({ judgeability: 'judgeable', published: true });
    const asked = await actualAsked.list(actorId, projectId);
    expect(asked.map(({ questionText }) => questionText)).toEqual(['您小时候住在哪里？']);

    const snapshotId = await context.create({
      actorId,
      consumerSessionId: secondSessionId,
      expiresAt,
      projectId,
      requestId: randomUUID(),
    });
    expect(
      await prisma.contextSnapshotMemory.count({ where: { contextSnapshotId: snapshotId } }),
    ).toBe(1);
    expect(
      await prisma.contextSnapshotActualQuestion.count({
        where: { contextSnapshotId: snapshotId },
      }),
    ).toBe(1);
    const contextSnapshot = await prisma.interviewContextSnapshot.findUniqueOrThrow({
      where: { id: snapshotId },
    });
    expect(contextSnapshot).toMatchObject({ actualQuestionCount: 1, memoryCount: 1 });
    expect(
      await prisma.aiDerivedOutput.findUniqueOrThrow({
        where: { id: contextSnapshot.aiDerivedOutputId },
      }),
    ).toMatchObject({ expectedMemoryCount: 1, expectedQuestionCount: 1 });

    const currentItem = current[0];
    if (currentItem === undefined) throw new Error('Expected one current memory item');
    const finalResolution = await prisma.memoryResolution.findUniqueOrThrow({
      where: { id: currentItem.id },
    });
    const finalOutputId = finalResolution.aiDerivedOutputId;
    if (finalOutputId === null) throw new Error('Expected automatic resolution provenance');
    expect(await eligibility.isEligible(actorId, finalOutputId)).toBe(true);
    const finalMember = await prisma.memoryResolutionMember.findFirstOrThrow({
      where: { memoryResolutionId: finalResolution.id },
    });
    const evidence = await prisma.memoryClaimEvidence.findFirstOrThrow({
      where: { memoryClaimId: finalMember.memoryClaimId },
    });
    await prisma.transcriptSegment.update({
      data: { correctedSpeakerRole: 'interviewer', speakerRoleRevision: { increment: 1 } },
      where: { id: evidence.transcriptSegmentId },
    });
    expect(await eligibility.isEligible(actorId, finalOutputId)).toBe(false);
  });

  it('persists every final watermark, closes request/trigger replay and links explicit retries', async () => {
    const requestId = randomUUID();
    const triggerDedupeKey = `memory_extract:test:${randomUUID()}`;
    const frozen = await coordinator.freeze({
      actorId,
      expiresAt: new Date(Date.now() + 3_600_000),
      jobType: 'memory_extract',
      projectId,
      requestId,
      sessionIds: [emptySessionId, firstSessionId, ineligibleSessionId, secondSessionId],
      triggerDedupeKey,
      trustedRole: 'elder',
    });
    const scopes = await prisma.aiJobSessionScope.findMany({
      orderBy: { sessionId: 'asc' },
      where: { aiJobId: frozen.id },
    });
    expect(scopes).toHaveLength(4);
    const emptyScope = scopes.find(({ sessionId }) => sessionId === emptySessionId);
    const zeroEligibleWithFinal = scopes.find(({ sessionId }) => sessionId === ineligibleSessionId);
    expect(emptyScope).toMatchObject({
      eligibleSegmentCount: 0,
      maxSegmentId: null,
      maxSegmentStartMs: null,
    });
    expect(zeroEligibleWithFinal?.eligibleSegmentCount).toBe(0);
    expect(zeroEligibleWithFinal?.maxSegmentId).not.toBeNull();
    expect(zeroEligibleWithFinal?.maxSegmentStartMs).not.toBeNull();
    expect(frozen.inputHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(frozen.inputHash).not.toBe('0'.repeat(64));

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.aiJobSessionScope.update({
          data: { maxSegmentId: null, maxSegmentStartMs: null },
          where: { id: zeroEligibleWithFinal?.id ?? '' },
        });
      }),
    ).rejects.toThrow('AI_JOB_SCOPE_FINAL_WATERMARK_MISMATCH');

    const replay = await coordinator.freeze({
      actorId,
      expiresAt: new Date(Date.now() + 3_600_000),
      jobType: 'memory_extract',
      projectId,
      requestId,
      sessionIds: [emptySessionId, firstSessionId, ineligibleSessionId, secondSessionId],
      triggerDedupeKey,
      trustedRole: 'elder',
    });
    expect(replay).toMatchObject({ id: frozen.id, replayed: true, status: 'running' });
    const triggerReplay = await coordinator.freeze({
      actorId,
      expiresAt: new Date(Date.now() + 3_600_000),
      jobType: 'memory_extract',
      projectId,
      requestId: randomUUID(),
      sessionIds: [emptySessionId, firstSessionId, ineligibleSessionId, secondSessionId],
      triggerDedupeKey,
      trustedRole: 'elder',
    });
    expect(triggerReplay.id).toBe(frozen.id);
    await expect(
      coordinator.freeze({
        actorId,
        expiresAt: new Date(Date.now() + 3_600_000),
        jobType: 'memory_extract',
        projectId,
        requestId,
        sessionIds: [secondSessionId],
        triggerDedupeKey,
        trustedRole: 'elder',
      }),
    ).rejects.toThrow('AI_REQUEST_IDENTITY_CONFLICT');

    await prisma.aiJob.update({
      data: { completedAt: new Date(), failureCode: 'TEST_AUTHORITY_FAILURE', status: 'cancelled' },
      where: { id: frozen.id },
    });
    const retry = await coordinator.freeze({
      actorId,
      expiresAt: new Date(Date.now() + 3_600_000),
      jobType: 'memory_extract',
      projectId,
      requestId: randomUUID(),
      retryOfJobId: frozen.id,
      sessionIds: [emptySessionId, firstSessionId, ineligibleSessionId, secondSessionId],
      trustedRole: 'elder',
    });
    expect(retry.id).not.toBe(frozen.id);
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: retry.id } })).retryOfJobId).toBe(
      frozen.id,
    );
    await coordinator.callProvider(retry, () => Promise.resolve({ retry: 'first-result' }));
    await coordinator.writeBack(retry, () => Promise.resolve(undefined));
    expect(
      await prisma.aiProviderCall.findUniqueOrThrow({
        where: { aiJobId_callNo: { aiJobId: retry.id, callNo: 1 } },
      }),
    ).toMatchObject({ inputHash: retry.inputHash, status: 'succeeded' });
    const completedReplay = await coordinator.freeze({
      actorId,
      expiresAt: new Date(Date.now() + 3_600_000),
      jobType: 'memory_extract',
      projectId,
      requestId: (await prisma.aiJob.findUniqueOrThrow({ where: { id: retry.id } })).requestId,
      retryOfJobId: frozen.id,
      sessionIds: [emptySessionId, firstSessionId, ineligibleSessionId, secondSessionId],
      trustedRole: 'elder',
    });
    expect(completedReplay).toMatchObject({ id: retry.id, replayed: true, status: 'succeeded' });
    expect(await prisma.aiProviderCall.count({ where: { aiJobId: retry.id } })).toBe(1);
  });

  it('persists cancelled after policy, text, role and memory drift and discards provider output', async () => {
    const assertCancelledAfter = async (
      mutate: (jobId: string) => Promise<void>,
      options: { memoryResolutionIds?: readonly string[] } = {},
    ): Promise<void> => {
      const job = await coordinator.freeze({
        actorId,
        expiresAt: new Date(Date.now() + 3_600_000),
        jobType: 'context_snapshot',
        memoryResolutionIds: options.memoryResolutionIds,
        projectId,
        requestId: randomUUID(),
        sessionIds: [secondSessionId],
        trustedRole: 'elder',
      });
      await coordinator.callProvider(job, () => Promise.resolve({ fictional: true }));
      await mutate(job.id);
      await expect(coordinator.writeBack(job, () => Promise.resolve(undefined))).rejects.toThrow();
      expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
        status: 'cancelled',
      });
      expect(
        await prisma.aiProviderCall.findUniqueOrThrow({
          where: { aiJobId_callNo: { aiJobId: job.id, callNo: 1 } },
        }),
      ).toMatchObject({ status: 'succeeded' });
    };

    await assertCancelledAfter(async () => {
      await prisma.elderProject.update({
        data: { aiPolicyRevision: { increment: 1 } },
        where: { id: projectId },
      });
    });

    const textTarget = await prisma.transcriptSegment.findFirstOrThrow({
      orderBy: { startMs: 'asc' },
      where: { sessionId: secondSessionId },
    });
    await assertCancelledAfter(async () => {
      await prisma.transcriptSegment.update({
        data: {
          correctedText: `${textTarget.originalText}（修正）`,
          textRevision: { increment: 1 },
        },
        where: { id: textTarget.id },
      });
    });

    const roleTarget = await prisma.transcriptSegment.findFirstOrThrow({
      orderBy: { startMs: 'asc' },
      where: { sessionId: secondSessionId },
    });
    await assertCancelledAfter(async () => {
      await prisma.transcriptSegment.update({
        data: { correctedSpeakerRole: 'interviewer', speakerRoleRevision: { increment: 1 } },
        where: { id: roleTarget.id },
      });
    });

    const memoryRootId = randomUUID();
    const claimId = randomUUID();
    const resolutionId = randomUUID();
    await prisma.memoryRetentionRoot.create({
      data: {
        expiresAt: new Date(Date.now() + 3_600_000),
        id: memoryRootId,
        projectId,
        retentionPolicyVersion: 1,
        sourceKind: 'human_confirmed',
        sourceOperationId: randomUUID(),
      },
    });
    await prisma.memoryClaim.create({
      data: {
        authority: 'human_confirmed',
        canonicalKey: '漂移测试',
        id: claimId,
        memoryRetentionRootId: memoryRootId,
        memoryType: 'event',
        normalizedValueDigest: sha256('fictional-memory'),
        projectId,
        valueJson: { value: '虚构旅行' },
        valueKind: 'exact',
      },
    });
    await prisma.memoryResolution.create({
      data: {
        authority: 'human_confirmed',
        canonicalKey: '漂移测试',
        id: resolutionId,
        memoryRetentionRootId: memoryRootId,
        memoryType: 'event',
        projectId,
        resolutionKind: 'single',
        resolutionRevision: 1,
        resolvedValueJson: { value: '虚构旅行' },
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
    await assertCancelledAfter(
      async () => {
        await prisma.memoryResolution.update({
          data: { status: 'superseded' },
          where: { id: resolutionId },
        });
      },
      { memoryResolutionIds: [resolutionId] },
    );
  });

  it('publishes question-sim-v1 semantic matches without false not-observed outcomes', async () => {
    const stream = await prisma.speakerStream.findFirstOrThrow({
      where: { sessionId: secondSessionId },
    });
    await prisma.transcriptSegment.create({
      data: {
        endMs: 7_900,
        ingestKey: `dev-006-semantic-${randomUUID()}`,
        originalRoleAuthority: 'user_confirmed',
        originalSpeakerRole: 'interviewer',
        originalText:
          '你的童年是在什么地方度过的？abc你好吗?你小时候不住在苏州吗？你和母亲最难忘的事是什么？',
        sessionId: secondSessionId,
        source: 'fixture',
        speakerRoleRevision: 2,
        speakerStreamId: stream.id,
        startMs: 4_000,
      },
    });
    const snapshots = await Promise.all([
      createDisplaySnapshot(secondSessionId, 1, '您小时候住在哪里？'),
      createDisplaySnapshot(secondSessionId, 2, 'ＡＢＣ，你好吗？'),
      createDisplaySnapshot(secondSessionId, 3, '你小时候住在苏州吗？'),
      createDisplaySnapshot(secondSessionId, 4, '你和父亲最难忘的事是什么？'),
    ]);
    const analysis = await questionEvidence.reconcileActualQuestions({
      actorId,
      expiresAt: new Date(Date.now() + 3_600_000),
      projectId,
      requestId: randomUUID(),
      sessionId: secondSessionId,
    });
    const outcomes = await prisma.suggestionOutcome.findMany({
      where: { actualQuestionAnalysisId: analysis.analysisId },
    });
    const bySnapshot = new Map(
      outcomes.map((outcome) => [outcome.questionDisplaySnapshotId, outcome]),
    );
    expect(bySnapshot.get(snapshots[0].id)).toMatchObject({ outcome: 'actual_asked' });
    expect(bySnapshot.get(snapshots[1].id)).toMatchObject({ outcome: 'actual_asked' });
    expect(bySnapshot.get(snapshots[2].id)).toMatchObject({ outcome: 'not_observed' });
    expect(bySnapshot.get(snapshots[3].id)).toMatchObject({ outcome: 'not_observed' });
    expect(
      await prisma.actualQuestion.count({
        where: {
          actualQuestionAnalysisId: analysis.analysisId,
          sourceKind: 'matched_system_suggestion',
        },
      }),
    ).toBe(2);
  });

  it('cancels context writeback when a frozen actual-question catalog is superseded', async () => {
    const questions = await actualAsked.list(actorId, projectId);
    expect(questions.length).toBeGreaterThan(0);
    const job = await coordinator.freeze({
      actorId,
      actualQuestionIds: questions.map(({ id }) => id),
      expiresAt: new Date(Date.now() + 3_600_000),
      jobType: 'context_snapshot',
      projectId,
      requestId: randomUUID(),
      sessionIds: [emptySessionId],
      trustedRole: 'interviewer',
    });
    expect(job.actualQuestions).toHaveLength(questions.length);
    const superseded = job.actualQuestions.at(-1);
    if (superseded === undefined) throw new Error('Expected a frozen actual question');
    await prisma.actualQuestionAnalysis.update({
      data: { isCurrentPublished: false, status: 'superseded' },
      where: { id: superseded.analysisId },
    });
    await expect(coordinator.writeBack(job, () => Promise.resolve(undefined))).rejects.toThrow(
      'AI_ACTUAL_QUESTION_INPUT_DRIFT',
    );
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      failureCode: 'AI_ACTUAL_QUESTION_INPUT_DRIFT',
      status: 'cancelled',
    });
    expect(await prisma.interviewContextSnapshot.count({ where: { aiJobId: job.id } })).toBe(0);
  });

  it('rejects expired/hidden snapshot and event dependencies and uses a separate cleanup pepper', async () => {
    const snapshots = await prisma.questionDisplaySnapshot.findMany({
      orderBy: { displaySequence: 'asc' },
      where: { sessionId: secondSessionId },
    });
    const eventRoot = snapshots[0];
    const hiddenRoot = snapshots[1];
    if (eventRoot === undefined || hiddenRoot === undefined) throw new Error('Expected snapshots');
    const event = await prisma.questionEvidenceEvent.create({
      data: {
        eventAt: new Date(),
        eventType: 'displayed',
        id: randomUUID(),
        requestId: randomUUID(),
        retentionDisplaySnapshotId: eventRoot.id,
        retentionOwnerKind: 'display_snapshot',
        sessionId: secondSessionId,
        snapshotId: eventRoot.id,
      },
    });
    const eventDigest = sha256(
      `${event.eventType}:${event.eventAt.toISOString()}:${event.requestId}`,
    );
    await expect(
      eligibility.isQuestionTargetEligible(
        actorId,
        'evidence_event',
        event.id,
        0,
        eventDigest,
        prisma,
      ),
    ).resolves.toBe(true);
    await prisma.questionDisplaySnapshot.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: eventRoot.id },
    });
    await expect(
      eligibility.isQuestionTargetEligible(
        actorId,
        'evidence_event',
        event.id,
        0,
        eventDigest,
        prisma,
      ),
    ).resolves.toBe(false);
    await expect(
      eligibility.isQuestionTargetEligible(
        actorId,
        'display_snapshot',
        eventRoot.id,
        eventRoot.publishedPresentationRevision,
        eventRoot.normalizedQuestionDigest,
        prisma,
      ),
    ).resolves.toBe(false);
    await prisma.questionDisplaySnapshot.update({
      data: { retentionState: 'cleanup_failed' },
      where: { id: hiddenRoot.id },
    });
    await expect(
      eligibility.isQuestionTargetEligible(
        actorId,
        'display_snapshot',
        hiddenRoot.id,
        hiddenRoot.publishedPresentationRevision,
        hiddenRoot.normalizedQuestionDigest,
        prisma,
      ),
    ).resolves.toBe(false);

    const rootId = randomUUID();
    const cleanupRequestId = randomUUID();
    await prisma.memoryRetentionRoot.create({
      data: {
        expiresAt: new Date(Date.now() - 1_000),
        id: rootId,
        projectId,
        retentionPolicyVersion: 1,
        sourceKind: 'system_migration',
        sourceOperationId: randomUUID(),
      },
    });
    await retention.hideExpired('memory_retention_root', rootId, cleanupRequestId);
    await retention.purge('memory_retention_root', rootId, cleanupRequestId);
    const retentionHash = createHmac('sha256', 'test-only-dev-006-retention-pepper')
      .update(`ai-retention/request/${cleanupRequestId}`, 'utf8')
      .digest('hex');
    const loginHash = createHmac('sha256', 'test-only-dev-006-policy-pepper')
      .update(`ai-retention/request/${cleanupRequestId}`, 'utf8')
      .digest('hex');
    expect(
      await prisma.aiRetentionCleanupAudit.findUnique({
        where: { cleanupRequestHash: retentionHash },
      }),
    ).not.toBeNull();
    expect(
      await prisma.aiRetentionCleanupAudit.findUnique({ where: { cleanupRequestHash: loginHash } }),
    ).toBeNull();
  });

  it('keeps an old reliable actual catalog when a later analysis is unjudged', async () => {
    await prisma.sessionFinalization.update({
      data: { transcriptStatus: 'degraded' },
      where: { sessionId: firstSessionId },
    });
    const result = await questionEvidence.reconcileActualQuestions({
      actorId,
      expiresAt: new Date(Date.now() - 1_000),
      projectId,
      requestId: randomUUID(),
      sessionId: firstSessionId,
    });
    expect(result).toMatchObject({ judgeability: 'unjudged', published: false });
    expect(
      await prisma.actualQuestionAnalysis.count({
        where: { isCurrentPublished: true, judgeability: 'judgeable', sessionId: firstSessionId },
      }),
    ).toBe(1);

    const job = await prisma.aiJob.findUniqueOrThrow({
      where: {
        id: (
          await prisma.actualQuestionAnalysis.findUniqueOrThrow({
            where: { id: result.analysisId },
          })
        ).aiJobId,
      },
    });
    const cleanupRequestId = randomUUID();
    await retention.hideExpired('ai_job', job.id, cleanupRequestId);
    await retention.purge('ai_job', job.id, cleanupRequestId);
    await expect(retention.purge('ai_job', job.id, cleanupRequestId)).resolves.toBeUndefined();
  });

  it('fails closed when the explicit local deletion-scope fixture reports a hit', async () => {
    await expect(currentMemory.list(randomUUID(), projectId)).rejects.toThrow();
    deletionFixture.blockProject(projectId);
    await expect(currentMemory.list(actorId, projectId)).rejects.toThrow('AI_POLICY_UNAVAILABLE');
    deletionFixture.clear();

    const humanResolution = await prisma.memoryResolution.findFirst({
      where: { authority: 'human_confirmed', canonicalKey: '漂移测试', projectId },
    });
    if (humanResolution !== null) {
      await prisma.memoryResolution.update({
        data: { status: 'current' },
        where: { id: humanResolution.id },
      });
      expect(
        (await currentMemory.list(actorId, projectId)).some(
          ({ canonicalKey }) => canonicalKey === '漂移测试',
        ),
      ).toBe(true);
      boundaryFixture.blockCanonicalKey(projectId, '漂移测试');
      expect(
        (await currentMemory.list(actorId, projectId)).some(
          ({ canonicalKey }) => canonicalKey === '漂移测试',
        ),
      ).toBe(false);
      boundaryFixture.clear();
    }
  });

  async function seedSession(
    sessionId: string,
    sequence: number,
    segments: readonly { role: 'elder' | 'interviewer'; text: string }[],
  ): Promise<void> {
    const streamId = randomUUID();
    await prisma.speakerStream.create({
      data: { closedAt: new Date(), id: streamId, sessionId, status: 'closed' },
    });
    for (const [index, segment] of segments.entries()) {
      await prisma.transcriptSegment.create({
        data: {
          endMs: index * 1_000 + 900,
          id: randomUUID(),
          ingestKey: `dev-006-${String(sequence)}-${String(index)}`,
          originalRoleAuthority: 'user_confirmed',
          originalSpeakerRole: segment.role,
          originalText: segment.text,
          sessionId,
          source: 'fixture',
          speakerRoleRevision: 1,
          speakerStreamId: streamId,
          startMs: index * 1_000,
        },
      });
    }
    const audioObjectId = randomUUID();
    await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        id: audioObjectId,
        mimeType: 'audio/wav',
        projectId,
        purpose: 'interview',
        sessionId,
        status: 'initiated',
      },
    });
    await prisma.sessionFinalization.create({
      data: {
        audioObjectId,
        audioStatus: 'complete',
        captureEndedAt: new Date(),
        commitmentsChecksum: '0'.repeat(64),
        createdBy: actorId,
        expectedChunkCount: 1,
        sessionId,
        stopRequestId: randomUUID(),
        transcriptStatus: 'drained',
      },
    });
  }

  async function createDisplaySnapshot(
    sessionId: string,
    displaySequence: number,
    questionText: string,
  ): Promise<QuestionDisplaySnapshot> {
    return prisma.questionDisplaySnapshot.create({
      data: {
        boundaryPolicyRevision: 0,
        contextBuilderVersion: 'dev-006.test',
        adaptationReasonCode: null,
        displayedAt: new Date(),
        displaySequence,
        evidenceManifestHash: EMPTY_MANIFEST_HASH,
        expiresAt: new Date(Date.now() + 3_600_000),
        memoryManifestHash: EMPTY_MANIFEST_HASH,
        modelName: 'local-test-structured',
        normalizedQuestionDigest: normalizeQuestionDigest(questionText),
        promptVersion: 'dev-006.test',
        purpose: 'detail',
        publishedPresentationRevision: displaySequence,
        questionText,
        reasonText: '虚构测试原因',
        retentionPolicyVersion: 1,
        roleWatermarkHash: EMPTY_MANIFEST_HASH,
        schemaVersion: 'dev-006.test',
        selectionMode: 'verbatim',
        selectionPolicyVersion: 'selection-test-v1',
        selectionScore: 0.9,
        sessionId,
        similarityPolicyVersion: 'question-sim-v1',
        sourceBank: 'basic',
        sourceBankVersion: 'dev-006-legacy-test',
        sourceQuestionId: `dev-006-${String(displaySequence)}`,
        journeyPolicyVersion: 'journey_policy_v1',
        journeyStage: 'rapport',
      },
    });
  }
});
