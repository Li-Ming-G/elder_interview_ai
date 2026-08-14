import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import {
  FICTIONAL_CONTINUING_CONSENT_VERSION,
  SyntheticConsentContinuationPolicyReader,
} from '../../apps/api/src/project-foundation/consent-continuation.policy.js';
import { PostSessionCoordinationService } from '../../apps/api/src/project-foundation/post-session-coordination.service.js';

describe('DEV-008B2 durable post-session and opening coordination', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordinator: PostSessionCoordinationService;

  const actorId = randomUUID();
  const projectId = randomUUID();
  const basisSessionId = randomUUID();
  const consumerSessionId = randomUUID();
  const basisCompletedAt = new Date('2026-08-14T08:00:00.000Z');
  let finalizationId = '';

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

    const consumerAudioId = randomUUID();
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
    await prisma.questionDisplayState.deleteMany({ where: { sessionId: consumerSessionId } });
    await prisma.aiJob.deleteMany({ where: { projectId } });
    await prisma.speakerCalibrationAttempt.deleteMany({ where: { sessionId: consumerSessionId } });
    await prisma.transcriptSegment.deleteMany({ where: { sessionId: basisSessionId } });
    await prisma.speakerStream.deleteMany({
      where: { sessionId: { in: [basisSessionId, consumerSessionId] } },
    });
    await prisma.sessionFinalization.deleteMany({ where: { sessionId: basisSessionId } });
    await prisma.sessionCaptureGeneration.deleteMany({ where: { sessionId: consumerSessionId } });
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

  it('runs both completed lanes and creates exactly one opening through duplicate delivery', async () => {
    coordinator.notifyFinalization(finalizationId);
    coordinator.notifyFinalization(finalizationId);
    coordinator.notifyCalibration(consumerSessionId);
    await eventually(
      async () =>
        (await prisma.questionGenerationAttempt.count({
          where: { attemptKind: 'second_session_opening', sessionId: consumerSessionId },
        })) === 1,
    );

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
    expect(
      (await prisma.aiJob.findUniqueOrThrow({ where: { id: contextSnapshot.aiJobId } }))
        .contextBuilderVersion,
    ).toBe('dev-008b2.v1:m=succeeded:a=succeeded');

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
    expect(
      (
        await prisma.aiJobSessionScope.findMany({
          orderBy: { sessionId: 'asc' },
          where: { aiJobId: openingAttempt.aiJobId },
        })
      ).map(({ sessionId }) => sessionId),
    ).toEqual([basisSessionId, consumerSessionId].sort());

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
    expect(typeof opening?.attempt_id).toBe('string');
    expect(typeof opening?.request_id).toBe('string');
  });
});

async function eventually(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for durable coordination');
}
