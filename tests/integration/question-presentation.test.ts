import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LocalTestDeletionScopeFixtureReader } from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import type { AuthPrincipal } from '../../apps/api/src/auth/auth.types.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { ActualAskedReader } from '../../apps/api/src/question-evidence/question-evidence.service.js';
import { QuestionPresentationService } from '../../apps/api/src/question-evidence/question-presentation.service.js';
import { QuestionOrchestrationService } from '../../apps/api/src/question-orchestration/question-orchestration.service.js';
import { QuestionDirector } from '../../apps/api/src/question-orchestration/question-director.js';
import { QuestionBankImportService } from '../../apps/api/src/question-bank/question-bank.service.js';

describe('DEV-007B constrained question publication', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestration: QuestionOrchestrationService;
  let presentations: QuestionPresentationService;
  let actualAsked: ActualAskedReader;
  let deletion: LocalTestDeletionScopeFixtureReader;
  let imports: QuestionBankImportService;
  let director: QuestionDirector;
  let releaseId: string;
  const speakerStreamId = randomUUID();

  const actorId = randomUUID();
  const projectId = randomUUID();
  const sessionId = randomUUID();
  const actor: AuthPrincipal = {
    displayName: 'DEV-007B fictional listener',
    id: actorId,
    role: 'interviewer',
    sessionId: randomUUID(),
    sessionTokenHash: 'test-only',
    status: 'active',
  };

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-dev-007b-policy-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-dev-007b-retention-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    orchestration = app.get(QuestionOrchestrationService);
    presentations = app.get(QuestionPresentationService);
    actualAsked = app.get(ActualAskedReader);
    deletion = app.get(LocalTestDeletionScopeFixtureReader);
    imports = app.get(QuestionBankImportService);
    director = app.get(QuestionDirector);

    for (const release of await prisma.questionBankRelease.findMany({
      where: { environmentScope: 'internal_demo', status: 'active' },
    })) {
      await imports.retireRelease(release.id, 'DEV-007B test setup', randomUUID());
    }
    const version = `fixture-dev-007b-${randomUUID()}`;
    const imported = await imports.importDraft(
      new TextEncoder().encode(fixtureCsv(version)),
      'DEV-007B test setup',
      randomUUID(),
    );
    releaseId = imported.releaseId;
    await imports.activateRelease(releaseId, 'DEV-007B test setup', randomUUID());

    await prisma.user.create({
      data: {
        displayName: actor.displayName,
        email: `dev-007b-${actorId}@example.test`,
        id: actorId,
        passwordHash: 'test-only',
        role: 'interviewer',
      },
    });
    await prisma.elderProject.create({
      data: {
        createdBy: actorId,
        displayName: 'DEV-007B fictional elder',
        id: projectId,
        status: 'active',
      },
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
    await prisma.interviewSession.create({
      data: { createdBy: actorId, id: sessionId, projectId, sequenceNo: 1, status: 'recording' },
    });
    await prisma.speakerStream.create({
      data: { closedAt: new Date(), id: speakerStreamId, sessionId, status: 'closed' },
    });
  });

  afterAll(async () => {
    deletion.clear();
    await prisma.idempotencyRecord.deleteMany({ where: { actorId } });
    await prisma.aiJob.deleteMany({ where: { projectId } });
    await prisma.interviewSession.deleteMany({ where: { projectId } });
    await prisma.consentRecord.deleteMany({ where: { projectId } });
    await prisma.projectAssignment.deleteMany({ where: { projectId } });
    await prisma.elderProject.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    const release = await prisma.questionBankRelease.findUnique({ where: { id: releaseId } });
    if (release?.status === 'active') {
      await imports.retireRelease(releaseId, 'DEV-007B test cleanup', randomUUID());
    }
    await app.close();
  });

  it('publishes only licensed fixture candidates through the writer and keeps REST/history safe', async () => {
    const failedRequestId = randomUUID();
    const failedInputs: string[] = [];
    const invalidGenerate = vi.spyOn(director, 'generate').mockImplementation((request) => {
      failedInputs.push(JSON.stringify(request));
      return Promise.resolve({ decision: 'suggest', question: 'invalid' });
    });
    await orchestration.requestManualNext(actor, sessionId, {
      expectedPresentationRevision: 0,
      expectedSnapshotId: null,
      requestId: failedRequestId,
    });
    const failed = await waitForTerminal(failedRequestId);
    invalidGenerate.mockRestore();
    expect(failed.status).toBe('failed');
    expect(failed.current).toMatchObject({
      kind: 'continue_listening',
      presentation_revision: 0,
      snapshot_id: null,
    });
    expect(failedInputs).toHaveLength(2);
    expect(failedInputs[1]).toBe(failedInputs[0]);
    expect(
      await prisma.questionCandidate.count({
        where: { questionGenerationAttemptId: failed.attempt_id },
      }),
    ).toBe(0);
    expect(await prisma.questionDisplaySnapshot.count({ where: { sessionId } })).toBe(0);
    await ageManualFence();

    const firstRequestId = randomUUID();
    const accepted = await orchestration.requestManualNext(actor, sessionId, {
      expectedPresentationRevision: 0,
      expectedSnapshotId: null,
      requestId: firstRequestId,
    });
    const first = await waitForTerminal(firstRequestId);
    expect(first.status).toBe('succeeded');
    expect(first.publication_outcome).toBe('published');
    expect(first.current).toMatchObject({
      display_sequence: 1,
      kind: 'suggestion',
      presentation_revision: 1,
    });
    expect(first.current.question).toBe('如果您愿意，可以先从小时候住过的地方讲起吗？');
    expect(accepted.attempt_id).toBe(first.attempt_id);

    const firstCandidate = await prisma.questionCandidate.findFirstOrThrow({
      where: { questionGenerationAttemptId: first.attempt_id },
    });
    const firstSnapshot = await prisma.questionDisplaySnapshot.findUniqueOrThrow({
      where: { id: first.current.snapshot_id ?? '' },
    });
    expect(firstCandidate).toMatchObject({
      generationOrigin: 'model_generated',
      journeyStage: 'rapport',
      purpose: 'scene',
    });
    expect(firstSnapshot).toMatchObject({
      purpose: firstCandidate.purpose,
    });
    const firstAttempt = await prisma.questionGenerationAttempt.findUniqueOrThrow({
      where: { id: first.attempt_id },
    });
    expect(
      await prisma.questionGenerationBankInputMembership.count({
        where: { aiJobId: firstAttempt.aiJobId },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.questionCandidateBankReference.count({
        where: { questionCandidateId: firstCandidate.id },
      }),
    ).toBe(1);
    expect(await actualAsked.list(actorId, projectId)).toEqual([]);

    const replay = await orchestration.requestManualNext(actor, sessionId, {
      expectedPresentationRevision: 0,
      expectedSnapshotId: null,
      requestId: firstRequestId,
    });
    expect(replay.attempt_id).toBe(first.attempt_id);
    expect(
      await prisma.questionGenerationAttempt.count({ where: { requestId: firstRequestId } }),
    ).toBe(1);
    const throttledRequestId = randomUUID();
    await expect(
      orchestration.requestManualNext(actor, sessionId, {
        expectedPresentationRevision: 1,
        expectedSnapshotId: first.current.snapshot_id,
        requestId: throttledRequestId,
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(
      await prisma.idempotencyRecord.findUnique({ where: { requestId: throttledRequestId } }),
    ).toMatchObject({ action: 'question_suggestion.manual_next_throttled', targetId: sessionId });

    await ageManualFence();
    await expect(
      orchestration.requestManualNext(actor, sessionId, {
        expectedPresentationRevision: 1,
        expectedSnapshotId: first.current.snapshot_id,
        requestId: throttledRequestId,
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(await prisma.aiJob.count({ where: { requestId: throttledRequestId } })).toBe(0);
    const secondRequestId = randomUUID();
    await prisma.transcriptSegment.create({
      data: {
        endMs: 900,
        ingestKey: `dev-007b-free-${randomUUID()}`,
        originalRoleAuthority: 'user_confirmed',
        originalSpeakerRole: 'elder',
        originalText: '我小时候住在河边，院子里有一棵桂花树。',
        sessionId,
        source: 'fixture',
        speakerRoleRevision: 0,
        speakerStreamId,
        startMs: 0,
      },
    });
    const originalGenerate = director.generate.bind(director);
    const retryInputs: string[] = [];
    const generate = vi
      .spyOn(director, 'generate')
      .mockImplementationOnce((request) => {
        retryInputs.push(JSON.stringify(request));
        return Promise.resolve({ decision: 'suggest', question: 'invalid' });
      })
      .mockImplementationOnce((request) => {
        retryInputs.push(JSON.stringify(request));
        return originalGenerate(request);
      });
    await orchestration.requestManualNext(actor, sessionId, {
      expectedPresentationRevision: 1,
      expectedSnapshotId: first.current.snapshot_id,
      requestId: secondRequestId,
    });
    const second = await waitForTerminal(secondRequestId);
    generate.mockRestore();
    expect(retryInputs).toHaveLength(2);
    expect(retryInputs[1]).toBe(retryInputs[0]);
    const secondAttempt = await prisma.questionGenerationAttempt.findUniqueOrThrow({
      where: { id: second.attempt_id },
    });
    expect(
      await prisma.aiProviderCall.findMany({
        orderBy: { callNo: 'asc' },
        select: { callKind: true, callNo: true, inputHash: true },
        where: { aiJobId: secondAttempt.aiJobId },
      }),
    ).toEqual([
      expect.objectContaining({ callKind: 'primary', callNo: 1 }),
      expect.objectContaining({ callKind: 'same_input_retry', callNo: 2 }),
    ]);
    expect(second.publication_outcome).toBe('published');
    expect(second.current).toMatchObject({ display_sequence: 2, presentation_revision: 2 });
    expect(second.current.snapshot_id).not.toBe(first.current.snapshot_id);
    const secondCandidate = await prisma.questionCandidate.findFirstOrThrow({
      where: { questionGenerationAttemptId: second.attempt_id },
    });
    expect(secondCandidate).toMatchObject({
      generationOrigin: 'model_generated',
      purpose: 'timeline',
    });
    expect(
      await prisma.questionCandidateBankReference.count({
        where: { questionCandidateId: secondCandidate.id },
      }),
    ).toBe(0);

    const beforeRead = {
      attempts: await prisma.questionGenerationAttempt.count({ where: { sessionId } }),
      events: await prisma.questionEvidenceEvent.count({ where: { sessionId } }),
      snapshots: await prisma.questionDisplaySnapshot.count({ where: { sessionId } }),
    };
    const history = await presentations.history(actor, sessionId, {
      anchor: null,
      cursor: null,
      limit: 20,
    });
    expect(history.items.map(({ display_sequence }) => display_sequence)).toEqual([2, 1]);
    expect(history.items.every(({ kind }) => kind === 'suggestion')).toBe(true);
    expect(history.items[0]).toMatchObject({ newer_cursor: null });
    expect(history.items[0]?.older_cursor).not.toBeNull();
    expect(history.items[1]).toMatchObject({ older_cursor: null });
    expect(history.items[1]?.newer_cursor).not.toBeNull();

    const restored = await presentations.historyItem(
      actor,
      sessionId,
      first.current.snapshot_id ?? '',
    );
    expect(restored).toMatchObject({
      item: {
        display_sequence: 1,
        kind: 'suggestion',
        older_cursor: null,
        snapshot_id: first.current.snapshot_id,
      },
      session_id: sessionId,
    });
    expect(restored.item.newer_cursor).not.toBeNull();
    const newer = await presentations.history(actor, sessionId, {
      anchor: history.anchor,
      cursor: history.items[1]?.newer_cursor ?? null,
      limit: 20,
    });
    expect(newer.items.map(({ display_sequence }) => display_sequence)).toEqual([2]);
    await expect(presentations.historyItem(actor, sessionId, randomUUID())).rejects.toMatchObject({
      status: 410,
    });
    expect({
      attempts: await prisma.questionGenerationAttempt.count({ where: { sessionId } }),
      events: await prisma.questionEvidenceEvent.count({ where: { sessionId } }),
      snapshots: await prisma.questionDisplaySnapshot.count({ where: { sessionId } }),
    }).toEqual(beforeRead);

    deletion.blockProject(projectId);
    const withdrawn = await presentations.current(actor, sessionId);
    expect(withdrawn).toMatchObject({
      kind: 'withdrawn',
      question: null,
      reason: null,
      withdrawal_reason: 'deletion_active',
    });
    const withdrawnHistory = await presentations.history(actor, sessionId, {
      anchor: null,
      cursor: null,
      limit: 20,
    });
    expect(
      withdrawnHistory.items.every(
        ({ kind, question }) => kind === 'withdrawn' && question === null,
      ),
    ).toBe(true);
    deletion.clear();
    expect(await presentations.current(actor, sessionId)).toMatchObject({
      kind: 'withdrawn',
      withdrawal_reason: 'deletion_active',
    });
  });

  async function waitForTerminal(
    requestId: string,
  ): Promise<Awaited<ReturnType<QuestionPresentationService['status']>>> {
    for (let index = 0; index < 100; index += 1) {
      const result = await presentations.status(actor, sessionId, requestId);
      if (['succeeded', 'failed', 'cancelled'].includes(result.status)) return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Suggestion request did not settle');
  }

  async function ageManualFence(): Promise<void> {
    const old = new Date(Date.now() - 10_000);
    await prisma.questionDisplayState.update({
      data: { lastManualAttemptAcceptedAt: old },
      where: { sessionId },
    });
    await prisma.questionEvidenceEvent.updateMany({
      data: { eventAt: old },
      where: { eventType: 'manual_next_requested', sessionId },
    });
  }
});

function fixtureCsv(version: string): string {
  return [
    'question_id,bank,topic,question_text,purpose,applicable_when,inapplicable_when,sensitivity,source_type,source_reference,license_status,license_reference,bank_version,enabled',
    `fixture-rapport-a,basic,童年环境,如果您愿意，可以先从小时候住过的地方讲起吗？,scene,stage.rapport,,low,synthetic_fixture,INTERNAL_DEMO_ONLY,fixture_only,NOT_PRODUCT_CONTENT,${version},true`,
    `fixture-rapport-b,basic,童年细节,小时候最常陪伴您的东西是什么？,detail,stage.rapport,,low,synthetic_fixture,INTERNAL_DEMO_ONLY,fixture_only,NOT_PRODUCT_CONTENT,${version},true`,
    `fixture-story-deep,deep,重要选择,那次选择之前您最犹豫的是什么？,choice,stage.story_depth;context.choice,,medium,synthetic_fixture,INTERNAL_DEMO_ONLY,fixture_only,NOT_PRODUCT_CONTENT,${version},true`,
  ].join('\n');
}
