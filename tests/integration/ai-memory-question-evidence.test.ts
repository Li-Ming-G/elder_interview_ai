import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiOutputEligibilityService } from '../../apps/api/src/ai-runtime/ai-output-eligibility.service.js';
import { AiRetentionService } from '../../apps/api/src/ai-runtime/ai-retention.service.js';
import { LocalTestDeletionScopeFixtureReader } from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { InterviewContextService } from '../../apps/api/src/memory/interview-context.service.js';
import { CurrentMemoryReader, MemoryService } from '../../apps/api/src/memory/memory.service.js';
import {
  ActualAskedReader,
  QuestionEvidenceService,
} from '../../apps/api/src/question-evidence/question-evidence.service.js';

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

  const actorId = randomUUID();
  const projectId = randomUUID();
  const firstSessionId = randomUUID();
  const secondSessionId = randomUUID();

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-dev-006-policy-pepper',
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
  });

  afterAll(async () => {
    deletionFixture.clear();
    await prisma.aiRetentionCleanupAudit.deleteMany({
      where: { rootIdHash: { not: '' } },
    });
    await prisma.memoryResolutionMember.deleteMany();
    await prisma.contextSnapshotMemory.deleteMany();
    await prisma.contextSnapshotActualQuestion.deleteMany();
    await prisma.aiJob.deleteMany({ where: { projectId } });
    await prisma.questionDisplaySnapshot.deleteMany({
      where: { sessionId: { in: [firstSessionId, secondSessionId] } },
    });
    await prisma.memoryRetentionRoot.deleteMany({ where: { projectId } });
    await prisma.sessionFinalization.deleteMany({
      where: { sessionId: { in: [firstSessionId, secondSessionId] } },
    });
    await prisma.transcriptSegment.deleteMany({
      where: { sessionId: { in: [firstSessionId, secondSessionId] } },
    });
    await prisma.speakerStream.deleteMany({
      where: { sessionId: { in: [firstSessionId, secondSessionId] } },
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
});
