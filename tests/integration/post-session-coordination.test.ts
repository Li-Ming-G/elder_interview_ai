import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../apps/api/src/create-application.js';
import { AiJobCoordinatorService } from '../../apps/api/src/ai-runtime/ai-job-coordinator.service.js';
import { DecisionTraceReader } from '../../apps/api/src/ai-runtime/decision-trace.reader.js';
import { DecisionTraceService } from '../../apps/api/src/ai-runtime/decision-trace.service.js';
import { LocalTestDeletionScopeFixtureReader } from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { InterviewContextService } from '../../apps/api/src/memory/interview-context.service.js';
import {
  MEMORY_MAINTAINER_RUNTIME_CONFIG,
  type MemoryMaintainerRuntimeConfig,
} from '../../apps/api/src/memory/memory-maintainer.runtime.js';
import { CurrentMemoryReader } from '../../apps/api/src/memory/memory.service.js';
import {
  FICTIONAL_CONTINUING_CONSENT_VERSION,
  SyntheticConsentContinuationPolicyReader,
} from '../../apps/api/src/project-foundation/consent-continuation.policy.js';
import { PostSessionCoordinationService } from '../../apps/api/src/project-foundation/post-session-coordination.service.js';
import { ActualAskedReader } from '../../apps/api/src/question-evidence/question-evidence.service.js';
import {
  calibrationAttemptGateIdentity,
  openingContextRequestId,
  openingContextTriggerKey,
  openingRequestId,
  openingTriggerKey,
  postSessionLaneTriggerKey,
  postSessionTriggerIdentity,
  secondSessionOpeningIdentity,
} from '../../apps/api/src/project-foundation/post-session-coordination.identity.js';

describe('DEV-008B2 durable post-session and opening coordination', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordinator: PostSessionCoordinationService;
  let jobs: AiJobCoordinatorService;
  let contexts: InterviewContextService;
  let memories: CurrentMemoryReader;
  let questions: ActualAskedReader;
  let decisionTraceReader: DecisionTraceReader;
  let decisionTraces: DecisionTraceService;
  let deletion: LocalTestDeletionScopeFixtureReader;

  const actorId = randomUUID();
  const projectId = randomUUID();
  const basisSessionId = randomUUID();
  const consumerSessionId = randomUUID();
  const basisCompletedAt = new Date('2026-08-14T08:00:00.000Z');
  let finalizationId = '';
  let consumerAudioId = '';
  let firstCaptureId = '';
  let firstStreamId = '';
  let restartConsumerSessionId = '';
  let restartConsumerAudioId = '';

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-dev-008b2-retention-pepper',
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-dev-008b2-auth-pepper',
        DATABASE_URL: databaseUrl,
      }),
      { consentContinuationPolicyReader: new SyntheticConsentContinuationPolicyReader() },
    );
    await app.init();
    prisma = app.get(PrismaService);
    coordinator = app.get(PostSessionCoordinationService);
    jobs = app.get(AiJobCoordinatorService);
    contexts = app.get(InterviewContextService);
    memories = app.get(CurrentMemoryReader);
    questions = app.get(ActualAskedReader);
    decisionTraceReader = app.get(DecisionTraceReader);
    decisionTraces = app.get(DecisionTraceService);
    deletion = app.get(LocalTestDeletionScopeFixtureReader);

    await prisma.user.create({
      data: {
        displayName: 'DEV-008B2 fictional listener',
        email: `dev-008b2-${actorId}@example.test`,
        id: actorId,
        passwordHash: 'test-only',
        role: 'interviewer',
      },
    });
    await prisma.elderProject.create({
      data: {
        createdBy: actorId,
        displayName: 'DEV-008B2 fictional elder',
        id: projectId,
        status: 'active',
      },
    });
    await prisma.projectAssignment.create({ data: { projectId, userId: actorId } });
    await prisma.consentRecord.create({
      data: {
        consentMethod: 'electronic',
        consentTextVersion: FICTIONAL_CONTINUING_CONSENT_VERSION,
        consentType: 'recording_transcription_ai',
        consentedAt: new Date(),
        createdBy: actorId,
        projectId,
        status: 'valid',
      },
    });
    await prisma.interviewSession.createMany({
      data: [
        {
          createdBy: actorId,
          id: basisSessionId,
          projectId,
          sequenceNo: 1,
          speakerRoleRevision: 1,
          status: 'completed',
        },
        {
          createdBy: actorId,
          id: consumerSessionId,
          projectId,
          sequenceNo: 2,
          speakerRoleRevision: 1,
          status: 'recording',
        },
      ],
    });
    const basisStreamId = randomUUID();
    await prisma.speakerStream.create({
      data: {
        closedAt: basisCompletedAt,
        id: basisStreamId,
        sessionId: basisSessionId,
        status: 'closed',
      },
    });
    await prisma.transcriptSegment.createMany({
      data: [
        {
          endMs: 900,
          id: randomUUID(),
          ingestKey: `dev-008b2-elder-${basisSessionId}`,
          originalRoleAuthority: 'user_confirmed',
          originalSpeakerRole: 'elder',
          originalText: '记忆[place:故乡]=苏州',
          sessionId: basisSessionId,
          source: 'fixture',
          speakerRoleRevision: 1,
          speakerStreamId: basisStreamId,
          startMs: 0,
        },
        {
          endMs: 1_900,
          id: randomUUID(),
          ingestKey: `dev-008b2-interviewer-${basisSessionId}`,
          originalRoleAuthority: 'user_confirmed',
          originalSpeakerRole: 'interviewer',
          originalText: '您小时候住在哪里？',
          sessionId: basisSessionId,
          source: 'fixture',
          speakerRoleRevision: 1,
          speakerStreamId: basisStreamId,
          startMs: 1_000,
        },
      ],
    });
    const basisAudioId = randomUUID();
    await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        id: basisAudioId,
        mimeType: 'audio/webm',
        projectId,
        purpose: 'interview',
        sessionId: basisSessionId,
        status: 'initiated',
      },
    });
    const finalization = await prisma.sessionFinalization.create({
      data: {
        audioObjectId: basisAudioId,
        audioStatus: 'complete',
        captureEndedAt: basisCompletedAt,
        commitmentsChecksum: '0'.repeat(64),
        completedAt: basisCompletedAt,
        createdBy: actorId,
        expectedChunkCount: 1,
        sessionId: basisSessionId,
        stopRequestId: randomUUID(),
        transcriptStatus: 'drained',
      },
    });
    finalizationId = finalization.id;

    consumerAudioId = randomUUID();
    await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        id: consumerAudioId,
        mimeType: 'audio/webm',
        projectId,
        purpose: 'interview',
        sessionId: consumerSessionId,
        status: 'initiated',
      },
    });
    const capture = await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: consumerAudioId,
        audioStreamId: randomUUID(),
        confirmedActiveAt: new Date(),
        generationNo: 0,
        sessionId: consumerSessionId,
        status: 'active',
        timelineOffsetMs: 0,
      },
    });
    firstCaptureId = capture.id;
    const consumerStream = await prisma.speakerStream.create({
      data: { captureGenerationId: capture.id, sessionId: consumerSessionId, status: 'active' },
    });
    firstStreamId = consumerStream.id;
    await prisma.speakerCalibrationAttempt.create({
      data: {
        attemptNo: 1,
        audioStreamId: capture.audioStreamId,
        captureGenerationId: capture.id,
        endMs: 200,
        endSequenceNo: 2,
        resolvedAt: new Date('2026-08-14T08:01:00.000Z'),
        resolvedBy: actorId,
        resolvedRequestId: randomUUID(),
        sessionId: consumerSessionId,
        speakerStreamId: consumerStream.id,
        startMs: 0,
        startedBy: actorId,
        startedRequestId: randomUUID(),
        startSequenceNo: 0,
        status: 'confirmed',
      },
    });
  });

  afterAll(async () => {
    coordinator.onModuleDestroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sessionIds = (
      await prisma.interviewSession.findMany({ select: { id: true }, where: { projectId } })
    ).map(({ id }) => id);
    const resolutionIds = (
      await prisma.memoryResolution.findMany({ select: { id: true }, where: { projectId } })
    ).map(({ id }) => id);
    await prisma.memoryResolutionMember.deleteMany({
      where: { memoryResolutionId: { in: resolutionIds } },
    });
    const contextIds = (
      await prisma.interviewContextSnapshot.findMany({ select: { id: true }, where: { projectId } })
    ).map(({ id }) => id);
    await prisma.contextSnapshotMemory.deleteMany({
      where: { contextSnapshotId: { in: contextIds } },
    });
    await prisma.contextSnapshotActualQuestion.deleteMany({
      where: { contextSnapshotId: { in: contextIds } },
    });
    await prisma.questionDisplayState.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.aiJob.deleteMany({ where: { projectId } });
    await prisma.speakerCalibrationAttempt.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.transcriptSegment.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.speakerStream.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.sessionFinalization.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.sessionCaptureGeneration.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.audioObject.deleteMany({ where: { projectId } });
    await prisma.interviewSession.deleteMany({ where: { projectId } });
    await prisma.consentRecord.deleteMany({ where: { projectId } });
    await prisma.projectAssignment.deleteMany({ where: { projectId } });
    await prisma.elderProject.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await app.close();
  });

  it('keeps calibration-first waiting free of request, attempt and Context side effects', async () => {
    const consumer = await prisma.interviewSession.findUniqueOrThrow({
      where: { id: consumerSessionId },
    });
    const projection = await coordinator.project(consumer);
    expect(projection.secondSessionOpening).toMatchObject({
      attempt_id: null,
      request_id: null,
      status: 'waiting_basis_analysis',
    });
    expect(
      await prisma.questionGenerationAttempt.count({ where: { sessionId: consumerSessionId } }),
    ).toBe(0);
    expect(await prisma.interviewContextSnapshot.count({ where: { consumerSessionId } })).toBe(0);
  });

  it('binds the gate to the current stream and consumes exactly one authoritative opening', async () => {
    const rotatedAt = new Date('2026-08-14T08:02:00.000Z');
    await prisma.speakerStream.update({
      data: { closedAt: rotatedAt, status: 'closed' },
      where: { id: firstStreamId },
    });
    await prisma.sessionCaptureGeneration.update({
      data: {
        interruptedAt: rotatedAt,
        interruptionReason: 'page_recovery_detected',
        status: 'interrupted',
      },
      where: { id: firstCaptureId },
    });
    const secondCapture = await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: consumerAudioId,
        audioStreamId: randomUUID(),
        confirmedActiveAt: rotatedAt,
        generationNo: 1,
        sessionId: consumerSessionId,
        status: 'active',
        timelineOffsetMs: 0,
      },
    });
    const secondStream = await prisma.speakerStream.create({
      data: {
        captureGenerationId: secondCapture.id,
        sessionId: consumerSessionId,
        status: 'active',
      },
    });
    const secondCalibration = await prisma.speakerCalibrationAttempt.create({
      data: {
        attemptNo: 1,
        audioStreamId: secondCapture.audioStreamId,
        captureGenerationId: secondCapture.id,
        sessionId: consumerSessionId,
        speakerStreamId: secondStream.id,
        startMs: 0,
        startSequenceNo: 0,
        startedBy: actorId,
        startedRequestId: randomUUID(),
        status: 'collecting',
      },
    });

    coordinator.notifyFinalization(finalizationId);
    coordinator.notifyFinalization(finalizationId);
    coordinator.notifyCalibration(consumerSessionId);
    await eventually(
      async () =>
        (await prisma.aiJob.count({
          where: {
            jobType: { in: ['memory_extract', 'actual_question_reconcile'] },
            projectId,
            status: { in: ['succeeded', 'failed', 'cancelled'] },
          },
        })) === 2,
    );
    expect(
      await prisma.questionGenerationAttempt.count({
        where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
      }),
    ).toBe(0);
    expect(
      (
        await coordinator.project(
          await prisma.interviewSession.findUniqueOrThrow({ where: { id: consumerSessionId } }),
        )
      ).secondSessionOpening,
    ).toMatchObject({ attempt_id: null, request_id: null, status: 'waiting_calibration' });

    const secondResolvedAt = new Date('2026-08-14T08:03:00.000Z');
    await prisma.speakerCalibrationAttempt.update({
      data: {
        endMs: 200,
        endSequenceNo: 2,
        resolvedAt: secondResolvedAt,
        resolvedBy: actorId,
        resolvedRequestId: randomUUID(),
        status: 'confirmed',
      },
      where: { id: secondCalibration.id },
    });
    coordinator.notifyCalibration(consumerSessionId);
    await eventually(
      async () =>
        (await prisma.questionGenerationAttempt.count({
          where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
        })) === 1,
    );
    await eventually(async () => {
      const attempt = await prisma.questionGenerationAttempt.findFirst({
        where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
      });
      return attempt !== null && ['succeeded', 'failed', 'cancelled'].includes(attempt.status);
    });

    expect(
      await prisma.aiJob.count({
        where: {
          jobType: { in: ['memory_extract', 'actual_question_reconcile'] },
          projectId,
        },
      }),
    ).toBe(2);
    expect(await prisma.memoryResolution.count({ where: { projectId, status: 'current' } })).toBe(
      1,
    );
    expect(
      await prisma.actualQuestionAnalysis.count({
        where: { isCurrentPublished: true, judgeability: 'judgeable', projectId },
      }),
    ).toBe(1);
    expect(await prisma.interviewContextSnapshot.count({ where: { consumerSessionId } })).toBe(1);
    const contextSnapshot = await prisma.interviewContextSnapshot.findFirstOrThrow({
      where: { consumerSessionId },
    });
    expect(contextSnapshot).toMatchObject({
      actualLaneOutcome: 'succeeded',
      basisSessionId,
      calibrationConfirmed: true,
      consumerSessionId,
      memoryLaneOutcome: 'succeeded',
    });
    expect(contextSnapshot.actualLaneJobId).toEqual(expect.any(String));
    expect(contextSnapshot.basisAnalysisTriggerIdentity).toEqual(expect.any(String));
    expect(contextSnapshot.calibrationGateIdentity).toContain(secondStream.id);
    expect(contextSnapshot.memoryLaneJobId).toEqual(expect.any(String));
    expect(
      (
        await prisma.aiJob.findUniqueOrThrow({
          where: { id: contextSnapshot.memoryLaneJobId ?? undefined },
        })
      ).jobType,
    ).toBe('memory_extract');

    coordinator.notifyFinalization(finalizationId);
    coordinator.notifyCalibration(consumerSessionId);
    coordinator.notifyCalibration(consumerSessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      await prisma.questionGenerationAttempt.count({
        where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
      }),
    ).toBe(1);
    const openingAttempt = await prisma.questionGenerationAttempt.findFirstOrThrow({
      where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
    });
    expect(openingAttempt.interviewContextSnapshotId).toBe(contextSnapshot.id);
    expect(
      (
        await prisma.aiJobSessionScope.findMany({
          orderBy: { sessionId: 'asc' },
          where: { aiJobId: openingAttempt.aiJobId },
        })
      ).map(({ sessionId }) => sessionId),
    ).toEqual([basisSessionId, consumerSessionId].sort());
    const candidate = await prisma.questionCandidate.findUniqueOrThrow({
      where: { questionGenerationAttemptId: openingAttempt.id },
    });
    const [
      contextSegments,
      openingSegments,
      contextMemories,
      openingMemories,
      contextActual,
      openingActual,
    ] = await Promise.all([
      prisma.aiJobInputSegment.findMany({
        orderBy: { transcriptSegmentId: 'asc' },
        where: { aiJobId: contextSnapshot.aiJobId },
      }),
      prisma.aiJobInputSegment.findMany({
        orderBy: { transcriptSegmentId: 'asc' },
        where: { aiJobId: openingAttempt.aiJobId },
      }),
      prisma.contextSnapshotMemory.findMany({
        orderBy: { memoryResolutionId: 'asc' },
        where: { contextSnapshotId: contextSnapshot.id },
      }),
      prisma.aiJobInputMemory.findMany({
        orderBy: { memoryResolutionId: 'asc' },
        where: { aiJobId: openingAttempt.aiJobId },
      }),
      prisma.contextSnapshotActualQuestion.findMany({
        orderBy: { actualQuestionId: 'asc' },
        where: { contextSnapshotId: contextSnapshot.id },
      }),
      prisma.aiOutputQuestionDependency.findMany({
        orderBy: { targetId: 'asc' },
        where: { aiDerivedOutputId: candidate.aiDerivedOutputId },
      }),
    ]);
    expect(openingSegments.map(({ transcriptSegmentId }) => transcriptSegmentId)).toEqual(
      contextSegments.map(({ transcriptSegmentId }) => transcriptSegmentId),
    );
    expect(openingMemories.map(({ memoryResolutionId }) => memoryResolutionId)).toEqual(
      contextMemories.map(({ memoryResolutionId }) => memoryResolutionId),
    );
    expect(openingActual.map(({ targetId }) => targetId)).toEqual(
      contextActual.map(({ actualQuestionId }) => actualQuestionId),
    );
    expect(
      (
        await prisma.aiJobInputActualQuestion.findMany({
          orderBy: { actualQuestionId: 'asc' },
          where: { aiJobId: openingAttempt.aiJobId },
        })
      ).map(({ actualQuestionId }) => actualQuestionId),
    ).toEqual(contextActual.map(({ actualQuestionId }) => actualQuestionId));

    const thirdRotatedAt = new Date('2026-08-14T08:04:00.000Z');
    await prisma.speakerStream.update({
      data: { closedAt: thirdRotatedAt, status: 'closed' },
      where: { id: secondStream.id },
    });
    await prisma.sessionCaptureGeneration.update({
      data: {
        interruptedAt: thirdRotatedAt,
        interruptionReason: 'page_recovery_detected',
        status: 'interrupted',
      },
      where: { id: secondCapture.id },
    });
    const thirdCapture = await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: consumerAudioId,
        audioStreamId: randomUUID(),
        confirmedActiveAt: thirdRotatedAt,
        generationNo: 2,
        sessionId: consumerSessionId,
        status: 'active',
        timelineOffsetMs: 0,
      },
    });
    const thirdStream = await prisma.speakerStream.create({
      data: {
        captureGenerationId: thirdCapture.id,
        sessionId: consumerSessionId,
        status: 'active',
      },
    });
    await prisma.speakerCalibrationAttempt.create({
      data: {
        attemptNo: 1,
        audioStreamId: thirdCapture.audioStreamId,
        captureGenerationId: thirdCapture.id,
        sessionId: consumerSessionId,
        speakerStreamId: thirdStream.id,
        startMs: 0,
        startSequenceNo: 0,
        startedBy: actorId,
        startedRequestId: randomUUID(),
        status: 'collecting',
      },
    });
    coordinator.notifyCalibration(consumerSessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      await prisma.questionGenerationAttempt.count({
        where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
      }),
    ).toBe(1);

    const basis = await prisma.interviewSession.findUniqueOrThrow({
      where: { id: basisSessionId },
    });
    const consumer = await prisma.interviewSession.findUniqueOrThrow({
      where: { id: consumerSessionId },
    });
    expect((await coordinator.project(basis)).postSessionAnalysis).toMatchObject({
      actual_question_reconcile: { status: 'succeeded' },
      memory_extract: { status: 'succeeded' },
    });
    const opening = (await coordinator.project(consumer)).secondSessionOpening;
    expect(opening?.status).toBe('succeeded');
    expect(opening?.calibration_gate_identity).toBe(contextSnapshot.calibrationGateIdentity);
    expect(typeof opening?.attempt_id).toBe('string');
    expect(typeof opening?.request_id).toBe('string');
    const openingTrace = await prisma.decisionTrace.findUniqueOrThrow({
      where: { attemptId: openingAttempt.id },
    });
    await expect(decisionTraceReader.read(actorId, openingTrace.id)).resolves.toMatchObject({
      trace: { id: openingTrace.id },
    });
    deletion.blockSession(basisSessionId);
    await expect(decisionTraceReader.read(actorId, openingTrace.id)).rejects.toThrow(
      'DECISION_TRACE_UNAVAILABLE',
    );
    deletion.clear();
    await prisma.decisionTrace.delete({ where: { id: openingTrace.id } });
    const recoveredTraceId = await decisionTraces.recoverAttempt(openingAttempt.id);
    const recoveredTrace = await prisma.decisionTrace.findUniqueOrThrow({
      include: { p4Memberships: true },
      where: { id: recoveredTraceId },
    });
    expect(recoveredTrace.status).toBe('succeeded');
    expect(recoveredTrace.contextDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      recoveredTrace.p4Memberships
        .filter(({ sourceType }) => sourceType === 'actual_question')
        .map(({ sourceId }) => sourceId)
        .sort(),
    ).toEqual(contextActual.map(({ actualQuestionId }) => actualQuestionId).sort());
    await expect(decisionTraceReader.read(actorId, recoveredTraceId)).resolves.toMatchObject({
      trace: { id: recoveredTraceId },
    });
  });

  it('terminalizes a stale running attempt after ACK loss without consuming twice', async () => {
    const attempt = await prisma.questionGenerationAttempt.findFirstOrThrow({
      where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
    });
    const staleAt = new Date(Date.now() - 60_000);
    await prisma.aiJob.update({
      data: { completedAt: null, failureCode: null, startedAt: staleAt, status: 'running' },
      where: { id: attempt.aiJobId },
    });
    await prisma.questionGenerationAttempt.update({
      data: {
        completedAt: null,
        failureCode: null,
        publicationOutcome: null,
        resultKind: null,
        startedAt: staleAt,
        status: 'running',
      },
      where: { id: attempt.id },
    });

    coordinator.notifyCalibration(consumerSessionId);
    coordinator.notifyCalibration(consumerSessionId);
    await Promise.all([
      coordinator.reconcilePersistedState(),
      coordinator.reconcilePersistedState(),
    ]);
    await eventually(async () => {
      const recovered = await prisma.questionGenerationAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      return recovered.status === 'failed' && recovered.resultKind === 'unavailable';
    });
    expect(
      await prisma.questionGenerationAttempt.count({
        where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
      }),
    ).toBe(1);
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: attempt.aiJobId } })).status).toBe(
      'failed',
    );
  });

  it('reconciles a stale frozen job with no attempt on persisted-state startup', async () => {
    const secondCompletedAt = new Date('2026-08-14T09:00:00.000Z');
    await prisma.interviewSession.update({
      data: { status: 'completed' },
      where: { id: consumerSessionId },
    });
    const secondFinalization = await prisma.sessionFinalization.create({
      data: {
        audioObjectId: consumerAudioId,
        audioStatus: 'complete',
        captureEndedAt: secondCompletedAt,
        commitmentsChecksum: '1'.repeat(64),
        completedAt: secondCompletedAt,
        createdBy: actorId,
        expectedChunkCount: 1,
        sessionId: consumerSessionId,
        stopRequestId: randomUUID(),
        transcriptStatus: 'drained',
      },
    });
    coordinator.notifyFinalization(secondFinalization.id);
    const root = postSessionTriggerIdentity(consumerSessionId, secondCompletedAt);
    const memoryKey = postSessionLaneTriggerKey(root, 'memory_extract');
    const actualKey = postSessionLaneTriggerKey(root, 'actual_question_reconcile');
    await eventually(async () => {
      const laneJobs = await prisma.aiJob.findMany({
        where: { triggerDedupeKey: { in: [memoryKey, actualKey] } },
      });
      return (
        laneJobs.length === 2 &&
        laneJobs.every(({ status }) => ['succeeded', 'failed', 'cancelled'].includes(status))
      );
    });
    const [memoryJob, actualJob] = await Promise.all([
      prisma.aiJob.findFirstOrThrow({ where: { triggerDedupeKey: memoryKey } }),
      prisma.aiJob.findFirstOrThrow({ where: { triggerDedupeKey: actualKey } }),
    ]);

    const thirdSessionId = randomUUID();
    restartConsumerSessionId = thirdSessionId;
    await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        id: thirdSessionId,
        projectId,
        sequenceNo: 3,
        speakerRoleRevision: 1,
        status: 'recording',
      },
    });
    const thirdAudio = await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        mimeType: 'audio/webm',
        projectId,
        purpose: 'interview',
        sessionId: thirdSessionId,
        status: 'initiated',
      },
    });
    restartConsumerAudioId = thirdAudio.id;
    const thirdCapture = await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: thirdAudio.id,
        audioStreamId: randomUUID(),
        confirmedActiveAt: new Date(),
        generationNo: 0,
        sessionId: thirdSessionId,
        status: 'active',
        timelineOffsetMs: 0,
      },
    });
    const thirdStream = await prisma.speakerStream.create({
      data: {
        captureGenerationId: thirdCapture.id,
        sessionId: thirdSessionId,
        status: 'active',
      },
    });
    const thirdCalibration = await prisma.speakerCalibrationAttempt.create({
      data: {
        attemptNo: 1,
        audioStreamId: thirdCapture.audioStreamId,
        captureGenerationId: thirdCapture.id,
        sessionId: thirdSessionId,
        speakerStreamId: thirdStream.id,
        startMs: 0,
        startSequenceNo: 0,
        startedBy: actorId,
        startedRequestId: randomUUID(),
        status: 'collecting',
      },
    });
    const gateIdentity = calibrationAttemptGateIdentity({
      attemptId: thirdCalibration.id,
      speakerStreamId: thirdStream.id,
      status: 'confirmed',
    });
    const identity = secondSessionOpeningIdentity({
      basisAnalysisTriggerIdentity: root,
      calibrationGateIdentity: gateIdentity,
      consumerSessionId: thirdSessionId,
    });
    const contextSnapshotId = await contexts.create({
      actorId,
      contextBuilderVersion: 'dev-008b2-opening-context-v2',
      consumerSessionId: thirdSessionId,
      expiresAt: new Date(Date.now() + 86_400_000),
      openingProvenance: {
        actualLane: { jobId: actualJob.id, outcome: terminalOutcome(actualJob.status) },
        basisAnalysisTriggerIdentity: root,
        basisSessionId: consumerSessionId,
        calibrationConfirmed: true,
        calibrationGateIdentity: gateIdentity,
        memoryLane: { jobId: memoryJob.id, outcome: terminalOutcome(memoryJob.status) },
      },
      projectId,
      requestId: openingContextRequestId(identity),
      scopeSessionIds: [consumerSessionId, thirdSessionId],
      triggerDedupeKey: openingContextTriggerKey(identity),
      trustedRoles: ['elder', 'interviewer'],
    });
    const frozenContext = await contexts.readForOpening(actorId, thirdSessionId, contextSnapshotId);
    const frozenJob = await jobs.freeze({
      actorId,
      actualQuestionIds: frozenContext.actualAsked.map(({ id }) => id),
      expiresAt: new Date(Date.now() + 86_400_000),
      jobType: 'question_generate',
      memoryResolutionIds: frozenContext.memories.map(({ id }) => id),
      projectId,
      requestId: openingRequestId(identity),
      sessionIds: frozenContext.scopeSessionIds,
      sourceContextSnapshotId: contextSnapshotId,
      triggerDedupeKey: openingTriggerKey(identity),
      trustedRole: 'interviewer',
      trustedRoles: ['elder', 'interviewer'],
    });
    expect(frozenJob.replayed).toBe(false);
    await prisma.aiJob.update({
      data: { createdAt: new Date(Date.now() - 60_000), startedAt: null, status: 'pending' },
      where: { id: frozenJob.id },
    });
    await prisma.speakerCalibrationAttempt.update({
      data: {
        endMs: 200,
        endSequenceNo: 2,
        resolvedAt: new Date(),
        resolvedBy: actorId,
        resolvedRequestId: randomUUID(),
        status: 'confirmed',
      },
      where: { id: thirdCalibration.id },
    });

    coordinator.notifyCalibration(thirdSessionId);
    coordinator.notifyCalibration(thirdSessionId);
    await Promise.all([
      coordinator.reconcilePersistedState(),
      coordinator.reconcilePersistedState(),
    ]);
    await eventually(async () => {
      const attempt = await prisma.questionGenerationAttempt.findFirst({
        where: { attemptKind: 'second_session_opening', sessionId: thirdSessionId },
      });
      return (
        attempt !== null && attempt.status === 'failed' && attempt.resultKind === 'unavailable'
      );
    });
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: frozenJob.id } })).status).toBe(
      'failed',
    );
    expect(
      await prisma.questionGenerationAttempt.count({
        where: { attemptKind: 'second_session_opening', sessionId: thirdSessionId },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.questionGenerationAttempt.findFirstOrThrow({
          where: { attemptKind: 'second_session_opening', sessionId: thirdSessionId },
        })
      ).interviewContextSnapshotId,
    ).toBe(contextSnapshotId);
  });

  it('terminalizes a frozen context job with no snapshot and rejects late writeback', async () => {
    const basisCompletedAt = new Date('2026-08-14T10:00:00.000Z');
    await prisma.interviewSession.update({
      data: { status: 'completed' },
      where: { id: restartConsumerSessionId },
    });
    const finalization = await prisma.sessionFinalization.create({
      data: {
        audioObjectId: restartConsumerAudioId,
        audioStatus: 'complete',
        captureEndedAt: basisCompletedAt,
        commitmentsChecksum: '2'.repeat(64),
        completedAt: basisCompletedAt,
        createdBy: actorId,
        expectedChunkCount: 1,
        sessionId: restartConsumerSessionId,
        stopRequestId: randomUUID(),
        transcriptStatus: 'drained',
      },
    });
    coordinator.notifyFinalization(finalization.id);
    const root = postSessionTriggerIdentity(restartConsumerSessionId, basisCompletedAt);
    const laneKeys = [
      postSessionLaneTriggerKey(root, 'memory_extract'),
      postSessionLaneTriggerKey(root, 'actual_question_reconcile'),
    ];
    await eventually(async () => {
      const laneJobs = await prisma.aiJob.findMany({
        where: { triggerDedupeKey: { in: laneKeys } },
      });
      return (
        laneJobs.length === 2 &&
        laneJobs.every(({ status }) => ['succeeded', 'failed', 'cancelled'].includes(status))
      );
    });

    const consumerSessionId = randomUUID();
    await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        id: consumerSessionId,
        projectId,
        sequenceNo: 4,
        speakerRoleRevision: 1,
        status: 'recording',
      },
    });
    const audio = await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        mimeType: 'audio/webm',
        projectId,
        purpose: 'interview',
        sessionId: consumerSessionId,
        status: 'initiated',
      },
    });
    const capture = await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: audio.id,
        audioStreamId: randomUUID(),
        confirmedActiveAt: new Date(),
        generationNo: 0,
        sessionId: consumerSessionId,
        status: 'active',
        timelineOffsetMs: 0,
      },
    });
    const stream = await prisma.speakerStream.create({
      data: {
        captureGenerationId: capture.id,
        sessionId: consumerSessionId,
        status: 'active',
      },
    });
    const calibration = await prisma.speakerCalibrationAttempt.create({
      data: {
        attemptNo: 1,
        audioStreamId: capture.audioStreamId,
        captureGenerationId: capture.id,
        sessionId: consumerSessionId,
        speakerStreamId: stream.id,
        startMs: 0,
        startSequenceNo: 0,
        startedBy: actorId,
        startedRequestId: randomUUID(),
        status: 'collecting',
      },
    });
    const gateIdentity = calibrationAttemptGateIdentity({
      attemptId: calibration.id,
      speakerStreamId: stream.id,
      status: 'confirmed',
    });
    const identity = secondSessionOpeningIdentity({
      basisAnalysisTriggerIdentity: root,
      calibrationGateIdentity: gateIdentity,
      consumerSessionId,
    });
    const [currentMemories, actualAsked] = await Promise.all([
      memories.list(actorId, projectId),
      questions.list(actorId, projectId),
    ]);
    const orphan = await jobs.freeze({
      actorId,
      actualQuestionIds: actualAsked.map(({ id }) => id),
      contextBuilderVersion: 'dev-008b2-opening-context-v2',
      expiresAt: new Date(Date.now() + 86_400_000),
      jobType: 'context_snapshot',
      memoryResolutionIds: currentMemories.map(({ id }) => id),
      projectId,
      requestId: openingContextRequestId(identity),
      sessionIds: [restartConsumerSessionId, consumerSessionId],
      triggerDedupeKey: openingContextTriggerKey(identity),
      trustedRole: 'interviewer',
      trustedRoles: ['elder', 'interviewer'],
    });
    await prisma.aiJob.update({
      data: { startedAt: new Date(Date.now() - 60_000) },
      where: { id: orphan.id },
    });
    await prisma.speakerCalibrationAttempt.update({
      data: {
        endMs: 200,
        endSequenceNo: 2,
        resolvedAt: new Date(),
        resolvedBy: actorId,
        resolvedRequestId: randomUUID(),
        status: 'confirmed',
      },
      where: { id: calibration.id },
    });

    coordinator.notifyCalibration(consumerSessionId);
    coordinator.notifyCalibration(consumerSessionId);
    await Promise.all([
      coordinator.reconcilePersistedState(),
      coordinator.reconcilePersistedState(),
    ]);
    await eventually(async () => {
      const [contextJob, attempt] = await Promise.all([
        prisma.aiJob.findUniqueOrThrow({ where: { id: orphan.id } }),
        prisma.questionGenerationAttempt.findFirst({
          where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
        }),
      ]);
      return (
        contextJob.status === 'failed' &&
        attempt !== null &&
        attempt.status === 'failed' &&
        attempt.resultKind === 'unavailable'
      );
    });
    expect(await prisma.interviewContextSnapshot.count({ where: { aiJobId: orphan.id } })).toBe(0);
    expect(
      await prisma.questionGenerationAttempt.count({
        where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
      }),
    ).toBe(1);

    let lateWriteInvoked = false;
    await expect(
      jobs.writeBack(orphan, () => {
        lateWriteInvoked = true;
        return Promise.resolve();
      }),
    ).rejects.toThrow('AI_JOB_NOT_RUNNING');
    expect(lateWriteInvoked).toBe(false);
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: orphan.id } })).status).toBe(
      'failed',
    );
  });
});

describe('MEMORY-T2-T4-RUNTIME-001 P1 opening provenance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordinator: PostSessionCoordinationService;
  const actorId = randomUUID();
  const projectIds: string[] = [];

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-p1-opening-retention-pepper',
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-p1-opening-auth-pepper',
        DATABASE_URL: databaseUrl,
      }),
      { consentContinuationPolicyReader: new SyntheticConsentContinuationPolicyReader() },
    );
    await app.init();
    prisma = app.get(PrismaService);
    coordinator = app.get(PostSessionCoordinationService);
    const p1Config = app.get<MemoryMaintainerRuntimeConfig>(MEMORY_MAINTAINER_RUNTIME_CONFIG);
    p1Config.enabled = true;
    p1Config.legacyMemoryExtractEnabled = false;
    p1Config.postSessionMemoryLane = 'delegate_p1_final_flush';
    p1Config.unconsumedFinalAuthority = 'p1';
    await prisma.user.create({
      data: {
        displayName: 'P1 opening fictional listener',
        email: `p1-opening-${actorId}@example.test`,
        id: actorId,
        passwordHash: 'test-only',
        role: 'interviewer',
      },
    });
  });

  afterAll(async () => {
    coordinator.onModuleDestroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sessionIds = (
      await prisma.interviewSession.findMany({
        select: { id: true },
        where: { projectId: { in: projectIds } },
      })
    ).map(({ id }) => id);
    const resolutionIds = (
      await prisma.memoryResolution.findMany({
        select: { id: true },
        where: { projectId: { in: projectIds } },
      })
    ).map(({ id }) => id);
    const claimIds = (
      await prisma.memoryClaim.findMany({
        select: { id: true },
        where: { projectId: { in: projectIds } },
      })
    ).map(({ id }) => id);
    await prisma.memoryResolutionMember.deleteMany({
      where: { memoryResolutionId: { in: resolutionIds } },
    });
    await prisma.memoryClaimEvidence.deleteMany({ where: { memoryClaimId: { in: claimIds } } });
    const contextIds = (
      await prisma.interviewContextSnapshot.findMany({
        select: { id: true },
        where: { projectId: { in: projectIds } },
      })
    ).map(({ id }) => id);
    await prisma.contextSnapshotMemory.deleteMany({
      where: { contextSnapshotId: { in: contextIds } },
    });
    await prisma.contextSnapshotActualQuestion.deleteMany({
      where: { contextSnapshotId: { in: contextIds } },
    });
    await prisma.aiJob.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.memoryResolution.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.memoryClaim.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.memoryThread.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.memoryBoundary.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.questionDisplayState.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.speakerCalibrationAttempt.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.transcriptSegment.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.speakerStream.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.sessionFinalization.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.sessionCaptureGeneration.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.audioObject.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.interviewSession.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.consentRecord.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.projectAssignment.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.elderProject.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await app.close();
  });

  it.each(['succeeded', 'unjudged'] as const)(
    'consumes P1 %s authority into one second-session opening attempt',
    async (mode) => {
      const seeded = await seedP1OpeningPair(mode);
      coordinator.notifyFinalization(seeded.finalizationId);
      coordinator.notifyCalibration(seeded.consumerSessionId);
      await eventually(
        async () =>
          (await prisma.questionGenerationAttempt.count({
            where: {
              attemptKind: 'second_session_opening',
              sessionId: seeded.consumerSessionId,
            },
          })) === 1,
      );
      const context = await prisma.interviewContextSnapshot.findFirstOrThrow({
        where: { consumerSessionId: seeded.consumerSessionId },
      });
      const memoryJob = await prisma.aiJob.findUniqueOrThrow({
        where: { id: context.memoryLaneJobId ?? undefined },
      });
      expect(memoryJob).toMatchObject({
        failureCode: mode === 'unjudged' ? 'MEMORY_UNJUDGED' : null,
        jobType: 'working_memory_maintain',
        projectId: seeded.projectId,
      });
      expect(memoryJob.triggerDedupeKey).toMatch(
        new RegExp(`^memory-p1-v1\\.2:${seeded.basisSessionId}:`),
      );
      expect(context.memoryLaneOutcome).toBe(mode);
      const workingSnapshot = await prisma.memoryWorkingSnapshot.findUnique({
        where: { aiJobId: memoryJob.id },
      });
      if (mode === 'succeeded') {
        expect(workingSnapshot).toMatchObject({ contractVersion: 'memory-maintainer-v1.2' });
      } else {
        expect(workingSnapshot).toBeNull();
      }
      expect(
        await prisma.questionGenerationAttempt.count({
          where: {
            attemptKind: 'second_session_opening',
            sessionId: seeded.consumerSessionId,
          },
        }),
      ).toBe(1);
    },
  );

  async function seedP1OpeningPair(mode: 'succeeded' | 'unjudged'): Promise<{
    basisSessionId: string;
    consumerSessionId: string;
    finalizationId: string;
    projectId: string;
  }> {
    const projectId = randomUUID();
    const basisSessionId = randomUUID();
    const consumerSessionId = randomUUID();
    const completedAt = new Date();
    projectIds.push(projectId);
    await prisma.elderProject.create({
      data: { createdBy: actorId, displayName: `P1 ${mode} fictional elder`, id: projectId },
    });
    await prisma.projectAssignment.create({ data: { projectId, userId: actorId } });
    await prisma.consentRecord.create({
      data: {
        consentMethod: 'electronic',
        consentTextVersion: FICTIONAL_CONTINUING_CONSENT_VERSION,
        consentType: 'recording_transcription_ai',
        consentedAt: completedAt,
        createdBy: actorId,
        projectId,
        status: 'valid',
      },
    });
    await prisma.interviewSession.createMany({
      data: [
        {
          createdBy: actorId,
          id: basisSessionId,
          projectId,
          sequenceNo: 1,
          speakerRoleRevision: 1,
          status: 'completed',
        },
        {
          createdBy: actorId,
          id: consumerSessionId,
          projectId,
          sequenceNo: 2,
          speakerRoleRevision: 1,
          status: 'recording',
        },
      ],
    });
    const basisStream = await prisma.speakerStream.create({
      data: { closedAt: completedAt, sessionId: basisSessionId, status: 'closed' },
    });
    await prisma.transcriptSegment.createMany({
      data: [
        {
          endMs: 900,
          ingestKey: `p1-opening-elder-${basisSessionId}`,
          originalRoleAuthority: 'user_confirmed',
          originalSpeakerRole: 'elder',
          originalText: mode === 'succeeded' ? '工作记忆[fact:place:opening.home]=苏州' : '嗯',
          sessionId: basisSessionId,
          source: 'fixture',
          speakerRoleRevision: 1,
          speakerStreamId: basisStream.id,
          startMs: 0,
        },
        {
          endMs: 1_900,
          ingestKey: `p1-opening-interviewer-${basisSessionId}`,
          originalRoleAuthority: 'user_confirmed',
          originalSpeakerRole: 'interviewer',
          originalText: '您小时候住在哪里？',
          sessionId: basisSessionId,
          source: 'fixture',
          speakerRoleRevision: 1,
          speakerStreamId: basisStream.id,
          startMs: 1_000,
        },
      ],
    });
    const basisAudio = await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        mimeType: 'audio/webm',
        projectId,
        purpose: 'interview',
        sessionId: basisSessionId,
        status: 'initiated',
      },
    });
    const finalization = await prisma.sessionFinalization.create({
      data: {
        audioObjectId: basisAudio.id,
        audioStatus: 'complete',
        captureEndedAt: completedAt,
        commitmentsChecksum: '9'.repeat(64),
        completedAt,
        createdBy: actorId,
        expectedChunkCount: 1,
        sessionId: basisSessionId,
        stopRequestId: randomUUID(),
        transcriptStatus: 'drained',
      },
    });
    const consumerAudio = await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        mimeType: 'audio/webm',
        projectId,
        purpose: 'interview',
        sessionId: consumerSessionId,
        status: 'initiated',
      },
    });
    const capture = await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: consumerAudio.id,
        audioStreamId: randomUUID(),
        confirmedActiveAt: completedAt,
        generationNo: 0,
        sessionId: consumerSessionId,
        status: 'active',
        timelineOffsetMs: 0,
      },
    });
    const consumerStream = await prisma.speakerStream.create({
      data: { captureGenerationId: capture.id, sessionId: consumerSessionId, status: 'active' },
    });
    await prisma.speakerCalibrationAttempt.create({
      data: {
        attemptNo: 1,
        audioStreamId: capture.audioStreamId,
        captureGenerationId: capture.id,
        endMs: 200,
        endSequenceNo: 2,
        resolvedAt: completedAt,
        resolvedBy: actorId,
        resolvedRequestId: randomUUID(),
        sessionId: consumerSessionId,
        speakerStreamId: consumerStream.id,
        startMs: 0,
        startSequenceNo: 0,
        startedBy: actorId,
        startedRequestId: randomUUID(),
        status: 'confirmed',
      },
    });
    return { basisSessionId, consumerSessionId, finalizationId: finalization.id, projectId };
  }
});

function terminalOutcome(status: string): 'succeeded' | 'failed' | 'cancelled' {
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return status;
  throw new Error(`Expected terminal job, received ${status}`);
}

async function eventually(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for durable coordination');
}
