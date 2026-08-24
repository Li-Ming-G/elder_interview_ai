import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LocalTestDeletionScopeFixtureReader } from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import { AiRetentionService } from '../../apps/api/src/ai-runtime/ai-retention.service.js';
import { DecisionTraceReader } from '../../apps/api/src/ai-runtime/decision-trace.reader.js';
import { DecisionTraceService } from '../../apps/api/src/ai-runtime/decision-trace.service.js';
import type { AuthPrincipal } from '../../apps/api/src/auth/auth.types.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import type { Prisma } from '../../apps/api/src/generated/prisma/client.js';
import { ActualAskedReader } from '../../apps/api/src/question-evidence/question-evidence.service.js';
import { QuestionPresentationService } from '../../apps/api/src/question-evidence/question-presentation.service.js';
import { QuestionOrchestrationService } from '../../apps/api/src/question-orchestration/question-orchestration.service.js';
import { QuestionDirector } from '../../apps/api/src/question-orchestration/question-director.js';
import { QuestionBankImportService } from '../../apps/api/src/question-bank/question-bank.service.js';
import { RealtimeRuntimeService } from '../../apps/api/src/realtime-transcription/realtime-runtime.service.js';

describe('DEV-007B constrained question publication', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestration: QuestionOrchestrationService;
  let presentations: QuestionPresentationService;
  let actualAsked: ActualAskedReader;
  let deletion: LocalTestDeletionScopeFixtureReader;
  let imports: QuestionBankImportService;
  let director: QuestionDirector;
  let decisionTraces: DecisionTraceService;
  let decisionTraceReader: DecisionTraceReader;
  let retention: AiRetentionService;
  let realtime: RealtimeRuntimeService;
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
    decisionTraces = app.get(DecisionTraceService);
    decisionTraceReader = app.get(DecisionTraceReader);
    retention = app.get(AiRetentionService);
    realtime = app.get(RealtimeRuntimeService);

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
    await waitForTraceTerminal(firstRequestId);
    const firstTrace = await prisma.decisionTrace.findUniqueOrThrow({
      where: { requestId: firstRequestId },
      include: {
        memoryMemberships: true,
        p4Memberships: true,
        transcriptMemberships: true,
      },
    });
    expect(firstTrace.status).toBe('succeeded');
    expect(firstTrace.directorInvoked).toBe(true);
    expect(firstTrace.stage).toBe('publication');
    expect(typeof (firstTrace.stageTimingsJson as { total?: unknown }).total).toBe('number');
    expect(firstTrace.attemptId).toBe(first.attempt_id);
    expect(firstTrace.contextDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      firstTrace.p4Memberships.every(
        (item) => item.revisionStatus === 'available' || item.revisionStatus === 'unavailable',
      ),
    ).toBe(true);
    expect(firstTrace.memoryMemberships.every((item) => item.layer === 'unknown')).toBe(true);
    expect(firstTrace.p4Memberships.length).toBeGreaterThan(0);
    expect(
      firstTrace.transcriptMemberships.every((item) => item.effectiveTextDigest.length === 64),
    ).toBe(true);
    await prisma.decisionTrace.delete({ where: { id: firstTrace.id } });
    const repairedTraceId = await decisionTraces.recoverAttempt(first.attempt_id);
    const repairedTrace = await prisma.decisionTrace.findUniqueOrThrow({
      include: { p4Memberships: { orderBy: { inputOrder: 'asc' } } },
      where: { id: repairedTraceId },
    });
    expect(repairedTrace.status).toBe('succeeded');
    expect(repairedTrace.directorInvoked).toBe(true);
    expect(repairedTrace.stage).toBe('recovered');
    expect(
      repairedTrace.p4Memberships.map((item) => ({
        membershipDigest: item.membershipDigest,
        revision: item.revision,
        revisionStatus: item.revisionStatus,
        section: item.section,
        sourceId: item.sourceId,
        sourceType: item.sourceType,
        sourceVersion: item.sourceVersion,
      })),
    ).toEqual(
      firstTrace.p4Memberships
        .sort((left, right) => left.inputOrder - right.inputOrder)
        .map((item) => ({
          membershipDigest: item.membershipDigest,
          revision: item.revision,
          revisionStatus: item.revisionStatus,
          section: item.section,
          sourceId: item.sourceId,
          sourceType: item.sourceType,
          sourceVersion: item.sourceVersion,
        })),
    );

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

  it('uses the latest answer, bypasses Director while narration continues, and omits unsafe current text', async () => {
    const continueSessionId = randomUUID();
    const continueStreamId = randomUUID();
    await createSession(continueSessionId, continueStreamId, 2);
    await prisma.transcriptSegment.createMany({
      data: [
        transcript(
          continueSessionId,
          continueStreamId,
          0,
          '我不想说。后来然后还有很多事。',
          'elder',
        ),
        transcript(
          continueSessionId,
          continueStreamId,
          100,
          '那我们换一个轻松的话题。',
          'interviewer',
        ),
        transcript(
          continueSessionId,
          continueStreamId,
          200,
          '我小时候住在河边，后来院子里种了桂花树，然后每年秋天还有很多事情可以慢慢讲。',
          'elder',
        ),
      ],
    });
    const generate = vi.spyOn(director, 'generate');
    const requestId = randomUUID();
    await orchestration.requestManualNext(actor, continueSessionId, {
      expectedPresentationRevision: 0,
      expectedSnapshotId: null,
      requestId,
    });
    const outcome = await waitForTerminal(requestId, continueSessionId);
    const attempt = await prisma.questionGenerationAttempt.findUniqueOrThrow({
      where: { id: outcome.attempt_id },
    });
    expect(outcome).toMatchObject({
      publication_outcome: 'published',
      result_kind: 'continue_listening',
    });
    expect(generate).not.toHaveBeenCalled();
    generate.mockRestore();
    expect(await prisma.aiProviderCall.count({ where: { aiJobId: attempt.aiJobId } })).toBe(0);
    expect(
      await prisma.questionCandidate.count({ where: { questionGenerationAttemptId: attempt.id } }),
    ).toBe(0);

    const unsafeSessionId = randomUUID();
    const unsafeStreamId = randomUUID();
    await createSession(unsafeSessionId, unsafeStreamId, 3);
    await prisma.transcriptSegment.create({
      data: transcript(
        unsafeSessionId,
        unsafeStreamId,
        0,
        '我小时候住在河边，院子里有一棵桂花树。',
        'elder',
      ),
    });
    const firstRequestId = randomUUID();
    await orchestration.requestManualNext(actor, unsafeSessionId, {
      expectedPresentationRevision: 0,
      expectedSnapshotId: null,
      requestId: firstRequestId,
    });
    const first = await waitForTerminal(firstRequestId, unsafeSessionId);
    expect(first.current.snapshot_id).not.toBeNull();
    await prisma.questionDisplaySnapshot.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: first.current.snapshot_id ?? '' },
    });
    await ageManualFence(unsafeSessionId);
    const seenCurrent: unknown[] = [];
    const originalGenerate = director.generate.bind(director);
    const capture = vi.spyOn(director, 'generate').mockImplementation((request) => {
      seenCurrent.push(request.context.current_presentation);
      return originalGenerate(request);
    });
    const secondRequestId = randomUUID();
    await orchestration.requestManualNext(actor, unsafeSessionId, {
      expectedPresentationRevision: first.current.presentation_revision,
      expectedSnapshotId: first.current.snapshot_id,
      requestId: secondRequestId,
    });
    await waitForTerminal(secondRequestId, unsafeSessionId);
    capture.mockRestore();
    expect(seenCurrent[0]).toBeNull();
  });

  it('replaces a same-stage current from fresher grounding and gates the next automatic call before provider', async () => {
    const autoSessionId = randomUUID();
    const autoStreamId = randomUUID();
    await createSession(autoSessionId, autoStreamId, 4);
    const firstSegment = transcript(
      autoSessionId,
      autoStreamId,
      0,
      '我小时候住在河边，那是我一直记得的地方。',
      'elder',
    );
    await prisma.transcriptSegment.create({ data: firstSegment });
    const firstRequestId = randomUUID();
    const firstGenerate = vi.spyOn(director, 'generate').mockResolvedValueOnce({
      continue_reason_code: null,
      decision: 'suggest',
      declared_bank_references: [],
      grounding: [{ id: firstSegment.id, kind: 'segment' }],
      purpose: 'timeline',
      question: '您第一次搬到河边时，大约是什么时候？',
      reason: '先了解这段生活的时间线索。',
      risk: 'low',
    });
    await orchestration.requestManualNext(actor, autoSessionId, {
      expectedPresentationRevision: 0,
      expectedSnapshotId: null,
      requestId: firstRequestId,
    });
    const first = await waitForTerminal(firstRequestId, autoSessionId);
    firstGenerate.mockRestore();
    await prisma.questionDisplaySnapshot.update({
      data: { displayedAt: new Date(Date.now() - 20_000) },
      where: { id: first.current.snapshot_id ?? '' },
    });

    const latestSegment = transcript(
      autoSessionId,
      autoStreamId,
      1_000,
      'The courtyard had an old osmanthus tree beside the stone wall.',
      'elder',
    );
    await prisma.transcriptSegment.create({ data: latestSegment });
    const automaticGenerate = vi.spyOn(director, 'generate').mockResolvedValue({
      continue_reason_code: null,
      decision: 'suggest',
      declared_bank_references: [],
      grounding: [{ id: latestSegment.id, kind: 'segment' }],
      purpose: 'scene',
      question: 'What did that courtyard look like around the osmanthus tree?',
      reason: '刚刚出现了更具体的场景线索。',
      risk: 'low',
    });
    await runAutomatic(autoSessionId, latestSegment.id);
    expect(automaticGenerate).toHaveBeenCalledTimes(1);
    expect(await presentations.current(actor, autoSessionId)).toMatchObject({
      display_sequence: 2,
      question: 'What did that courtyard look like around the osmanthus tree?',
    });

    const thirdSegment = transcript(
      autoSessionId,
      autoStreamId,
      2_000,
      'There was an old wooden stool beneath it.',
      'elder',
    );
    await prisma.transcriptSegment.create({ data: thirdSegment });
    await runAutomatic(autoSessionId, thirdSegment.id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(automaticGenerate).toHaveBeenCalledTimes(1);
    automaticGenerate.mockRestore();
  });

  it('closes the synthetic finalized-event runtime path without blocking the live lane', async () => {
    const eventSessionId = randomUUID();
    const eventStreamId = randomUUID();
    await createSession(eventSessionId, eventStreamId, await nextSessionSequence());
    const eventSegments = [
      transcript(eventSessionId, eventStreamId, 0, '您小时候最常和谁一起玩？', 'interviewer'),
      transcript(eventSessionId, eventStreamId, 1_000, '我小时候住在河边。', 'elder'),
      transcript(eventSessionId, eventStreamId, 2_000, '那里很安静。', 'elder'),
    ];
    await prisma.transcriptSegment.createMany({ data: eventSegments });

    const generate = vi.spyOn(director, 'generate').mockResolvedValue({
      continue_reason_code: null,
      decision: 'suggest',
      declared_bank_references: [],
      grounding: [{ id: eventSegments[1]?.id ?? '', kind: 'segment' }],
      purpose: 'scene',
      question: '那条河边给您留下了什么印象？',
      reason: '从刚才提到的童年地点继续了解具体感受。',
      risk: 'low',
    });

    try {
      // This is the same event surface used by the realtime gateway after a
      // finalized transcript is persisted. It must return synchronously; the
      // bounded debounce and Director work run after the recording lane returns.
      for (const segment of eventSegments) {
        realtime.notifyFinalized({ segmentId: segment.id, sessionId: eventSessionId });
      }
      const automatic = await waitForAutomaticTerminal(eventSessionId);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(automatic).toMatchObject({
        publication_outcome: 'published',
        result_kind: 'suggestion',
        status: 'succeeded',
      });
      const automaticAttempt = await prisma.questionGenerationAttempt.findUniqueOrThrow({
        where: { id: automatic.attempt_id },
      });
      expect(automaticAttempt).toMatchObject({
        attemptKind: 'automatic',
        publicationOutcome: 'published',
        requestId: automatic.request_id,
        status: 'succeeded',
      });
      const automaticTrace = await prisma.decisionTrace.findUniqueOrThrow({
        include: { p4Memberships: true, transcriptMemberships: true },
        where: { requestId: automatic.request_id },
      });
      expect(automaticTrace).toMatchObject({
        attemptId: automatic.attempt_id,
        directorInvoked: true,
        stage: 'publication',
        status: 'succeeded',
      });
      expect(automaticTrace.transcriptMemberships).toHaveLength(eventSegments.length);
      expect(automaticTrace.p4Memberships.length).toBeGreaterThan(0);
      expect(JSON.stringify(automaticTrace)).not.toMatch(/我小时候|prompt|provider_payload/iu);

      // The optional P5 round uses the same generation/trace authority and is
      // reference-only at the trace boundary.
      const evidenceSessionId = randomUUID();
      const evidenceStreamId = randomUUID();
      await createSession(evidenceSessionId, evidenceStreamId, await nextSessionSequence());
      const evidenceSegment = transcript(
        evidenceSessionId,
        evidenceStreamId,
        0,
        '我小时候住在河边。',
        'elder',
      );
      await prisma.transcriptSegment.create({ data: evidenceSegment });
      generate.mockReset();
      generate
        .mockResolvedValueOnce({
          decision: 'request_evidence',
          evidence: { operation: 'search_transcript', request: { query: '河边' } },
        })
        .mockResolvedValueOnce({
          continue_reason_code: null,
          decision: 'suggest',
          declared_bank_references: [],
          grounding: [{ id: evidenceSegment.id, kind: 'segment' }],
          purpose: 'scene',
          question: '那条河边给您留下了什么记忆？',
          reason: '沿着被证据重新确认的线索继续。',
          risk: 'low',
        });
      const evidenceRequestId = randomUUID();
      await orchestration.requestManualNext(actor, evidenceSessionId, {
        expectedPresentationRevision: 0,
        expectedSnapshotId: null,
        requestId: evidenceRequestId,
      });
      const evidenceOutcome = await waitForTerminal(evidenceRequestId, evidenceSessionId);
      expect(evidenceOutcome).toMatchObject({
        publication_outcome: 'published',
        status: 'succeeded',
      });
      const evidenceTrace = await prisma.decisionTrace.findUniqueOrThrow({
        include: { evidenceCalls: true },
        where: { requestId: evidenceRequestId },
      });
      expect(evidenceTrace.evidenceCalls).toHaveLength(1);
      expect(evidenceTrace.evidenceCalls[0]).toMatchObject({
        invocationNo: 1,
        status: 'succeeded',
        targetType: 'search_transcript',
        tool: 'search_transcript',
      });
      expect(evidenceTrace.evidenceCalls[0]?.resultIds).toContain(evidenceSegment.id);
      expect(JSON.stringify(evidenceTrace)).not.toContain('我小时候住在河边');

      // A finalized event with a continuing-narration answer is a successful
      // semantic terminal result, not a Director failure or a fallback question.
      const continueSessionId = randomUUID();
      const continueStreamId = randomUUID();
      await createSession(continueSessionId, continueStreamId, await nextSessionSequence());
      const continueSegment = transcript(
        continueSessionId,
        continueStreamId,
        0,
        '我小时候住在河边，后来院子里种了桂花树，然后每年秋天还有很多事情可以慢慢讲。',
        'elder',
      );
      await prisma.transcriptSegment.create({ data: continueSegment });
      generate.mockReset();
      generate.mockResolvedValue({
        continue_reason_code: null,
        decision: 'suggest',
        declared_bank_references: [],
        grounding: [{ id: continueSegment.id, kind: 'segment' }],
        purpose: 'scene',
        question: '那段经历后来怎么样了？',
        reason: '从刚才提到的故事继续了解。',
        risk: 'low',
      });
      realtime.notifyFinalized({ segmentId: continueSegment.id, sessionId: continueSessionId });
      const continued = await waitForAutomaticTerminal(continueSessionId);
      expect(generate).not.toHaveBeenCalled();
      expect(continued).toMatchObject({
        publication_outcome: 'published',
        result_kind: 'continue_listening',
        status: 'succeeded',
      });
      const continuedAttempt = await prisma.questionGenerationAttempt.findUniqueOrThrow({
        where: { id: continued.attempt_id },
      });
      expect(continuedAttempt).toMatchObject({
        attemptKind: 'automatic',
        publicationOutcome: 'published',
        requestId: continued.request_id,
        resultKind: 'continue_listening',
        status: 'succeeded',
      });
      const continuedTrace = await prisma.decisionTrace.findUniqueOrThrow({
        where: { requestId: continued.request_id },
      });
      expect(continuedTrace).toMatchObject({
        decisionOutcome: 'continue_listening',
        directorInvoked: false,
        publicationOutcome: 'published',
        status: 'succeeded',
      });
      // Manual-next cancels the still-pending automatic gate and uses the same
      // durable presentation authority immediately.
      const manualSessionId = randomUUID();
      const manualStreamId = randomUUID();
      await createSession(manualSessionId, manualStreamId, await nextSessionSequence());
      const manualSegment = transcript(
        manualSessionId,
        manualStreamId,
        0,
        '我小时候住在河边，那是我一直记得的地方。',
        'elder',
      );
      await prisma.transcriptSegment.create({ data: manualSegment });
      generate.mockReset();
      generate.mockResolvedValue({
        continue_reason_code: null,
        decision: 'suggest',
        declared_bank_references: [],
        grounding: [{ id: manualSegment.id, kind: 'segment' }],
        purpose: 'scene',
        question: '那段经历后来怎么样了？',
        reason: '从刚才提到的故事继续了解。',
        risk: 'low',
      });
      realtime.notifyFinalized({ segmentId: manualSegment.id, sessionId: manualSessionId });
      const manualRequestId = randomUUID();
      await orchestration.requestManualNext(actor, manualSessionId, {
        expectedPresentationRevision: 0,
        expectedSnapshotId: null,
        requestId: manualRequestId,
      });
      const manual = await waitForTerminal(manualRequestId, manualSessionId);
      expect(manual).toMatchObject({
        publication_outcome: 'published',
        status: 'succeeded',
      });
      const manualAttempt = await prisma.questionGenerationAttempt.findUniqueOrThrow({
        where: { id: manual.attempt_id },
      });
      expect(manualAttempt).toMatchObject({
        attemptKind: 'manual_next',
        publicationOutcome: 'published',
        requestId: manual.request_id,
        status: 'succeeded',
      });
      expect(
        await prisma.questionGenerationAttempt.count({
          where: { attemptKind: 'automatic', sessionId: manualSessionId },
        }),
      ).toBe(0);
    } finally {
      generate.mockRestore();
    }
  });

  it('records pre-call timeout and policy drift without claiming Director invocation', async () => {
    const internal = orchestration as unknown as {
      complete(prepared: unknown): Promise<void>;
      prepare(
        actorId: string,
        sessionId: string,
        attemptKind: 'manual_next',
        requestId: string,
        basis: { presentationRevision: number; snapshotId: string | null },
      ): Promise<{
        attemptId: string;
        deadlineAt: number;
        job: { id: string } | null;
        shouldContinueListening: boolean;
        traceId: string;
      }>;
    };

    const timeoutSessionId = randomUUID();
    await createSession(timeoutSessionId, randomUUID(), 20);
    const timeoutRequestId = randomUUID();
    const timedOut = await internal.prepare(
      actorId,
      timeoutSessionId,
      'manual_next',
      timeoutRequestId,
      { presentationRevision: 0, snapshotId: null },
    );
    timedOut.shouldContinueListening = false;
    timedOut.deadlineAt = 0;
    await expect(internal.complete(timedOut)).rejects.toThrow('AI_PROVIDER_TIMEOUT');
    const timeoutTrace = await prisma.decisionTrace.findUniqueOrThrow({
      where: { requestId: timeoutRequestId },
    });
    expect(timeoutTrace).toMatchObject({
      directorInvoked: false,
      stage: 'director',
      status: 'failed',
    });
    expect(await prisma.aiProviderCall.count({ where: { aiJobId: timedOut.job?.id ?? '' } })).toBe(
      0,
    );

    const driftSessionId = randomUUID();
    await createSession(driftSessionId, randomUUID(), 21);
    const driftRequestId = randomUUID();
    const drifted = await internal.prepare(actorId, driftSessionId, 'manual_next', driftRequestId, {
      presentationRevision: 0,
      snapshotId: null,
    });
    drifted.shouldContinueListening = false;
    const consent = await prisma.consentRecord.findFirstOrThrow({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { projectId },
    });
    await prisma.consentRecord.update({
      data: { revokedAt: new Date(), status: 'revoked' },
      where: { id: consent.id },
    });
    await expect(internal.complete(drifted)).rejects.toThrow();
    const driftTrace = await prisma.decisionTrace.findUniqueOrThrow({
      where: { requestId: driftRequestId },
    });
    expect(driftTrace).toMatchObject({
      directorInvoked: false,
      stage: 'director',
      status: 'failed',
    });
    expect(await prisma.aiProviderCall.count({ where: { aiJobId: drifted.job?.id ?? '' } })).toBe(
      0,
    );
    await prisma.consentRecord.update({
      data: { revokedAt: null, status: 'valid' },
      where: { id: consent.id },
    });
  });

  it('terminalizes the attempt and job when persisted context attachment fails', async () => {
    const internal = orchestration as unknown as {
      prepare(
        actorId: string,
        sessionId: string,
        attemptKind: 'manual_next',
        requestId: string,
        basis: { presentationRevision: number; snapshotId: string | null },
      ): Promise<unknown>;
    };
    const contextFailureSessionId = randomUUID();
    await createSession(contextFailureSessionId, randomUUID(), 24);
    const requestId = randomUUID();
    const attach = vi
      .spyOn(decisionTraces, 'attachReferences')
      .mockRejectedValueOnce(new Error('TEST_CONTEXT_ATTACHMENT_FAILED'));

    await expect(
      internal.prepare(actorId, contextFailureSessionId, 'manual_next', requestId, {
        presentationRevision: 0,
        snapshotId: null,
      }),
    ).rejects.toThrow('TEST_CONTEXT_ATTACHMENT_FAILED');
    attach.mockRestore();

    const attempt = await prisma.questionGenerationAttempt.findUniqueOrThrow({
      where: { requestId },
    });
    expect(attempt).toMatchObject({
      failureCode: 'TEST_CONTEXT_ATTACHMENT_FAILED',
      publicationOutcome: 'policy_blocked',
      resultKind: 'unavailable',
      status: 'failed',
    });
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: attempt.aiJobId } })).toMatchObject({
      failureCode: 'TEST_CONTEXT_ATTACHMENT_FAILED',
      status: 'failed',
    });
    const trace = await prisma.decisionTrace.findUniqueOrThrow({
      include: { p4Memberships: true },
      where: { requestId },
    });
    expect(trace).toMatchObject({
      decisionOutcome: 'system_error',
      errorCode: 'TEST_CONTEXT_ATTACHMENT_FAILED',
      stage: 'context',
      status: 'failed',
    });
    expect(trace.contextDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(trace.p4Memberships.length).toBeGreaterThan(0);
  });

  it('repairs terminal-Trace child drift, fences late writeback, and preserves success', async () => {
    type Prepared = {
      attemptId: string;
      context: unknown;
      job: unknown;
      traceId: string;
    };
    const internal = orchestration as unknown as {
      complete(prepared: Prepared): Promise<void>;
      coordinator: {
        writeBack<T>(job: unknown, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
      };
      prepare(
        actorId: string,
        sessionId: string,
        attemptKind: 'manual_next',
        requestId: string,
        basis: { presentationRevision: number; snapshotId: string | null },
      ): Promise<Prepared>;
    };

    const crashSessionId = randomUUID();
    await createSession(crashSessionId, randomUUID(), 25);
    const crashRequestId = randomUUID();
    const crashed = await internal.prepare(actorId, crashSessionId, 'manual_next', crashRequestId, {
      presentationRevision: 0,
      snapshotId: null,
    });
    await decisionTraces.finalize(crashed.traceId, {
      decisionOutcome: 'system_error',
      errorCode: 'TEST_CRASH_AFTER_TRACE_TERMINAL',
      stage: 'context',
      status: 'failed',
    });
    await prisma.questionGenerationAttempt.update({
      data: { createdAt: new Date(Date.now() - 60_000) },
      where: { id: crashed.attemptId },
    });

    await expect(decisionTraces.reconcileMissingAttempts(0)).resolves.toBeGreaterThanOrEqual(1);
    const reconciledAttempt = await prisma.questionGenerationAttempt.findUniqueOrThrow({
      where: { id: crashed.attemptId },
    });
    expect(reconciledAttempt).toMatchObject({
      failureCode: 'TEST_CRASH_AFTER_TRACE_TERMINAL',
      publicationOutcome: 'policy_blocked',
      resultKind: 'unavailable',
      status: 'failed',
    });
    expect(
      await prisma.aiJob.findUniqueOrThrow({ where: { id: reconciledAttempt.aiJobId } }),
    ).toMatchObject({
      failureCode: 'TEST_CRASH_AFTER_TRACE_TERMINAL',
      status: 'failed',
    });
    expect(
      await prisma.decisionTrace.findUniqueOrThrow({ where: { id: crashed.traceId } }),
    ).toMatchObject({
      decisionOutcome: 'system_error',
      errorCode: 'TEST_CRASH_AFTER_TRACE_TERMINAL',
      stage: 'context',
      status: 'failed',
    });
    const lateWrite = vi.fn();
    await expect(
      internal.coordinator.writeBack(crashed.job, () => {
        lateWrite();
        return Promise.resolve(null);
      }),
    ).rejects.toThrow('AI_JOB_NOT_RUNNING');
    expect(lateWrite).not.toHaveBeenCalled();

    const successSessionId = randomUUID();
    await createSession(successSessionId, randomUUID(), 26);
    const successRequestId = randomUUID();
    const successful = await internal.prepare(
      actorId,
      successSessionId,
      'manual_next',
      successRequestId,
      { presentationRevision: 0, snapshotId: null },
    );
    await internal.complete(successful);
    const successfulTraceBefore = await prisma.decisionTrace.findUniqueOrThrow({
      where: { id: successful.traceId },
    });
    await expect(decisionTraces.recoverAttempt(successful.attemptId)).resolves.toBe(
      successful.traceId,
    );
    expect(
      await prisma.questionGenerationAttempt.findUniqueOrThrow({
        where: { id: successful.attemptId },
      }),
    ).toMatchObject({ status: 'succeeded' });
    expect(
      await prisma.aiJob.findUniqueOrThrow({
        where: { id: successfulTraceBefore.aiJobId ?? '' },
      }),
    ).toMatchObject({ status: 'succeeded' });
    expect(
      await prisma.decisionTrace.findUniqueOrThrow({ where: { id: successful.traceId } }),
    ).toMatchObject({
      completedAt: successfulTraceBefore.completedAt,
      decisionOutcome: successfulTraceBefore.decisionOutcome,
      status: 'succeeded',
    });
  });

  it('serializes begin/recovery and reference attachment/finalization by request identity', async () => {
    type Prepared = { attemptId: string; job: { id: string } | null; traceId: string };
    const internal = orchestration as unknown as {
      prepare(
        actorId: string,
        sessionId: string,
        attemptKind: 'manual_next',
        requestId: string,
        basis: { presentationRevision: number; snapshotId: string | null },
      ): Promise<Prepared>;
    };
    const holdRequestLock = async (
      requestId: string,
    ): Promise<{ release: () => void; settled: Promise<void> }> => {
      let release = (): void => undefined;
      let acquired = (): void => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const settled = prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`request:${requestId}`}, 0))`;
        acquired();
        await released;
      });
      await locked;
      return { release, settled };
    };
    const p4Reference = {
      included: true,
      inputOrder: 0,
      membershipDigest: 'f'.repeat(64),
      revision: 0,
      revisionStatus: 'available' as const,
      section: 'interview_state',
      sourceId: randomUUID(),
      sourceType: 'session',
    };

    const attachFirstSessionId = randomUUID();
    await createSession(attachFirstSessionId, randomUUID(), 27);
    const attachFirstRequestId = randomUUID();
    const attachFirst = await internal.prepare(
      actorId,
      attachFirstSessionId,
      'manual_next',
      attachFirstRequestId,
      { presentationRevision: 0, snapshotId: null },
    );
    await prisma.decisionTraceP4Membership.deleteMany({ where: { traceId: attachFirst.traceId } });
    await prisma.decisionTrace.update({
      data: { contextDigest: null, stage: 'prepare' },
      where: { id: attachFirst.traceId },
    });
    const attachFirstLock = await holdRequestLock(attachFirstRequestId);
    const attachPromise = decisionTraces.attachReferences(attachFirst.traceId, {
      contextDigest: 'a'.repeat(64),
      p4Memberships: [p4Reference],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const finalizeAfterAttach = decisionTraces.finalize(attachFirst.traceId, {
      decisionOutcome: 'continue_listening',
      publicationOutcome: 'published',
      status: 'succeeded',
    });
    attachFirstLock.release();
    await attachFirstLock.settled;
    await expect(Promise.all([attachPromise, finalizeAfterAttach])).resolves.toBeDefined();
    expect(
      await prisma.decisionTrace.findUniqueOrThrow({
        include: { p4Memberships: true },
        where: { id: attachFirst.traceId },
      }),
    ).toMatchObject({
      contextDigest: 'a'.repeat(64),
      p4Memberships: [expect.objectContaining({ sourceId: p4Reference.sourceId })],
      stage: 'context_frozen',
      status: 'succeeded',
    });

    const finalizeFirstSessionId = randomUUID();
    await createSession(finalizeFirstSessionId, randomUUID(), 28);
    const finalizeFirstRequestId = randomUUID();
    const finalizeFirst = await internal.prepare(
      actorId,
      finalizeFirstSessionId,
      'manual_next',
      finalizeFirstRequestId,
      { presentationRevision: 0, snapshotId: null },
    );
    await prisma.decisionTraceP4Membership.deleteMany({
      where: { traceId: finalizeFirst.traceId },
    });
    await prisma.decisionTrace.update({
      data: { contextDigest: null, stage: 'prepare' },
      where: { id: finalizeFirst.traceId },
    });
    const finalizeFirstLock = await holdRequestLock(finalizeFirstRequestId);
    const prematureFinalize = decisionTraces.finalize(finalizeFirst.traceId, {
      decisionOutcome: 'continue_listening',
      publicationOutcome: 'published',
      status: 'succeeded',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const attachAfterFinalize = decisionTraces.attachReferences(finalizeFirst.traceId, {
      contextDigest: 'b'.repeat(64),
      p4Memberships: [{ ...p4Reference, sourceId: randomUUID() }],
    });
    finalizeFirstLock.release();
    await finalizeFirstLock.settled;
    await expect(prematureFinalize).rejects.toThrow('DECISION_TRACE_CONTEXT_NOT_FROZEN');
    await expect(attachAfterFinalize).resolves.toBeUndefined();
    expect(
      await prisma.decisionTrace.findUniqueOrThrow({ where: { id: finalizeFirst.traceId } }),
    ).toMatchObject({ contextDigest: 'b'.repeat(64), stage: 'context_frozen', status: 'running' });
    await expect(
      decisionTraces.finalize(finalizeFirst.traceId, {
        decisionOutcome: 'continue_listening',
        publicationOutcome: 'published',
        status: 'succeeded',
      }),
    ).resolves.toBeUndefined();

    for (const beginFirst of [true, false]) {
      const targetSessionId = randomUUID();
      await createSession(targetSessionId, randomUUID(), beginFirst ? 29 : 30);
      const requestId = randomUUID();
      const prepared = await internal.prepare(actorId, targetSessionId, 'manual_next', requestId, {
        presentationRevision: 0,
        snapshotId: null,
      });
      const deletedTrace = await prisma.decisionTrace.delete({
        where: { id: prepared.traceId },
      });
      const staleAt = new Date(Date.now() - 60_000);
      await prisma.questionGenerationAttempt.update({
        data: { createdAt: staleAt, startedAt: staleAt },
        where: { id: prepared.attemptId },
      });
      const lock = await holdRequestLock(requestId);
      const begin = (): Promise<{ id: string }> =>
        decisionTraces.begin({
          aiJobId: deletedTrace.aiJobId,
          attemptId: prepared.attemptId,
          contextRevision: deletedTrace.contextRevision,
          decisionOutcome: 'unavailable',
          directorInvoked: false,
          expiresAt: deletedTrace.expiresAt,
          generationId: deletedTrace.generationId,
          inputHash: deletedTrace.inputHash,
          ownerActorId: deletedTrace.ownerActorId,
          projectId: deletedTrace.projectId,
          requestId,
          sessionId: deletedTrace.sessionId,
          stage: 'prepare',
          triggerType: deletedTrace.triggerType,
          workingRevision: null,
        });
      const first = beginFirst ? begin() : decisionTraces.recoverAttempt(prepared.attemptId);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = beginFirst ? decisionTraces.recoverAttempt(prepared.attemptId) : begin();
      lock.release();
      await lock.settled;
      const [firstResult, secondResult] = await Promise.all([first, second]);
      const firstId = typeof firstResult === 'string' ? firstResult : firstResult.id;
      const secondId = typeof secondResult === 'string' ? secondResult : secondResult.id;
      expect(secondId).toBe(firstId);
      expect(await prisma.decisionTrace.count({ where: { requestId } })).toBe(1);
    }
  });

  it('repairs a persisted attempt-without-Trace crash exactly once after restart grace', async () => {
    const internal = orchestration as unknown as {
      prepare(
        actorId: string,
        sessionId: string,
        attemptKind: 'manual_next',
        requestId: string,
        basis: { presentationRevision: number; snapshotId: string | null },
      ): Promise<{ attemptId: string; job: { id: string } | null; traceId: string }>;
    };
    const crashSessionId = randomUUID();
    await createSession(crashSessionId, randomUUID(), 22);
    const requestId = randomUUID();
    const prepared = await internal.prepare(actorId, crashSessionId, 'manual_next', requestId, {
      presentationRevision: 0,
      snapshotId: null,
    });
    await prisma.decisionTrace.delete({ where: { id: prepared.traceId } });
    const staleAt = new Date(Date.now() - 60_000);
    await prisma.questionGenerationAttempt.update({
      data: { createdAt: staleAt, startedAt: staleAt },
      where: { id: prepared.attemptId },
    });
    const [firstRepair, concurrentRepair] = await Promise.all([
      decisionTraces.recoverAttempt(prepared.attemptId),
      decisionTraces.recoverAttempt(prepared.attemptId),
    ]);
    expect(concurrentRepair).toBe(firstRepair);
    expect(
      await prisma.questionGenerationAttempt.findUniqueOrThrow({
        where: { id: prepared.attemptId },
      }),
    ).toMatchObject({
      failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
      publicationOutcome: 'policy_blocked',
      status: 'failed',
    });
    expect(
      await prisma.aiJob.findUniqueOrThrow({ where: { id: prepared.job?.id ?? '' } }),
    ).toMatchObject({
      failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
      status: 'failed',
    });
    const repaired = await prisma.decisionTrace.findUniqueOrThrow({
      include: { p4Memberships: true, transcriptMemberships: true },
      where: { id: firstRepair },
    });
    expect(repaired).toMatchObject({
      directorInvoked: false,
      publicationOutcome: 'policy_blocked',
      stage: 'recovered',
      status: 'unavailable',
    });
    expect(repaired.contextDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(repaired.p4Memberships.length).toBeGreaterThan(0);
  });

  it.each(['context_frozen', 'director', 'publication'] as const)(
    'preserves frozen recently-displayed membership after %s post-commit projection recovery',
    async (stage) => {
      const internal = orchestration as unknown as {
        prepare(
          actorId: string,
          sessionId: string,
          attemptKind: 'manual_next',
          requestId: string,
          basis: { presentationRevision: number; snapshotId: string | null },
        ): Promise<{ attemptId: string; traceId: string }>;
      };
      const targetSessionId = randomUUID();
      const sequenceNo = stage === 'context_frozen' ? 31 : stage === 'director' ? 32 : 33;
      await createSession(targetSessionId, randomUUID(), sequenceNo);
      const requestId = randomUUID();
      const prepared = await internal.prepare(actorId, targetSessionId, 'manual_next', requestId, {
        presentationRevision: 0,
        snapshotId: null,
      });
      const staleAt = new Date(Date.now() - 60_000);
      const frozenDigest = 'e'.repeat(64);
      const frozenDisplayId = randomUUID();
      await prisma.decisionTraceP4Membership.deleteMany({ where: { traceId: prepared.traceId } });
      const frozenMembership = await prisma.decisionTraceP4Membership.create({
        data: {
          dropReason: null,
          included: true,
          inputOrder: 0,
          membershipDigest: 'd'.repeat(64),
          revision: 7,
          revisionStatus: 'available',
          section: 'recently_displayed',
          sourceId: frozenDisplayId,
          sourceType: 'display_snapshot',
          traceId: prepared.traceId,
        },
      });
      const attempt = await prisma.questionGenerationAttempt.findUniqueOrThrow({
        where: { id: prepared.attemptId },
      });
      const completedAt = new Date(staleAt.getTime() + 1_000);
      await prisma.questionGenerationAttempt.update({
        data: {
          completedAt,
          failureCode: null,
          publicationOutcome: 'published',
          resultKind: 'suggestion',
          status: 'succeeded',
        },
        where: { id: prepared.attemptId },
      });
      await prisma.aiJob.update({
        data: { completedAt, failureCode: null, status: 'succeeded' },
        where: { id: attempt.aiJobId },
      });
      await prisma.decisionTrace.update({
        data: {
          contextDigest: frozenDigest,
          decisionOutcome: 'question',
          errorCode: 'POST_COMMIT_PROJECTION_FAILED',
          publicationOutcome: 'published',
          stage,
          startedAt: staleAt,
          status: 'failed',
        },
        where: { id: prepared.traceId },
      });
      await prisma.questionGenerationAttempt.update({
        data: { createdAt: staleAt, startedAt: staleAt },
        where: { id: prepared.attemptId },
      });

      await expect(decisionTraces.recoverAttempt(prepared.attemptId)).resolves.toBe(
        prepared.traceId,
      );

      const recovered = await prisma.decisionTrace.findUniqueOrThrow({
        include: { p4Memberships: true },
        where: { id: prepared.traceId },
      });
      expect(recovered.contextDigest).toBe(frozenDigest);
      expect(recovered.status).toBe('succeeded');
      expect(recovered.publicationOutcome).toBe('published');
      expect(recovered.decisionOutcome).toBe('question');
      expect(recovered.stage).toBe('recovered');
      expect(recovered.p4Memberships).toEqual([
        expect.objectContaining({
          id: frozenMembership.id,
          membershipDigest: 'd'.repeat(64),
          revision: 7,
          revisionStatus: 'available',
          section: 'recently_displayed',
          sourceId: frozenDisplayId,
          sourceType: 'display_snapshot',
        }),
      ]);
    },
  );

  it('keeps trace reads reference-only and purges the root with all memberships', async () => {
    const requestId = randomUUID();
    const traceInput = {
      contextRevision: 0,
      decisionOutcome: 'continue_listening',
      directorInvoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      inputHash: 'd'.repeat(64),
      ownerActorId: actorId,
      p4Memberships: [
        {
          included: true,
          inputOrder: 0,
          membershipDigest: null,
          revision: null,
          revisionStatus: 'unavailable',
          section: 'question_bank',
          sourceId: 'fixture-business-question-id',
          sourceType: 'question_bank_item',
        },
      ],
      projectId,
      requestId,
      sessionId,
      triggerType: 'manual_next',
      workingRevision: null,
    } as const;
    const [trace, concurrentReplay] = await Promise.all([
      decisionTraces.begin(traceInput),
      decisionTraces.begin(traceInput),
    ]);
    expect(concurrentReplay.id).toBe(trace.id);
    await decisionTraces.finalize(trace.id, {
      decisionOutcome: 'continue_listening',
      status: 'succeeded',
    });
    const readable = await decisionTraceReader.read(actorId, trace.id);
    expect(readable.trace.memoryMemberships).toHaveLength(0);
    expect(readable.trace.p4Memberships[0]?.sourceId).toBe('fixture-business-question-id');
    expect(JSON.stringify(readable)).not.toContain('transcript_text');
    expect(JSON.stringify(readable)).not.toContain('prompt_text');

    await prisma.decisionTrace.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: trace.id },
    });
    const cleanupRequestId = randomUUID();
    await retention.hideExpired('decision_trace', trace.id, cleanupRequestId);
    await expect(decisionTraceReader.read(actorId, trace.id)).rejects.toThrow(
      'DECISION_TRACE_UNAVAILABLE',
    );
    await retention.purge('decision_trace', trace.id, cleanupRequestId);
    expect(await prisma.decisionTrace.count({ where: { id: trace.id } })).toBe(0);
    expect(await prisma.decisionTraceMemoryMembership.count({ where: { traceId: trace.id } })).toBe(
      0,
    );
    expect(await prisma.decisionTraceP4Membership.count({ where: { traceId: trace.id } })).toBe(0);
  });

  async function waitForTerminal(
    requestId: string,
    targetSessionId = sessionId,
  ): Promise<Awaited<ReturnType<QuestionPresentationService['status']>>> {
    for (let index = 0; index < 100; index += 1) {
      const result = await presentations.status(actor, targetSessionId, requestId);
      if (['succeeded', 'failed', 'cancelled'].includes(result.status)) return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Suggestion request did not settle');
  }

  async function waitForTraceTerminal(requestId: string): Promise<void> {
    for (let index = 0; index < 100; index += 1) {
      const trace = await prisma.decisionTrace.findUnique({ where: { requestId } });
      if (trace !== null && trace.status !== 'running') return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Decision trace did not settle');
  }

  async function waitForAutomaticTerminal(
    targetSessionId: string,
  ): Promise<Awaited<ReturnType<QuestionPresentationService['status']>>> {
    for (let index = 0; index < 250; index += 1) {
      const attempt = await prisma.questionGenerationAttempt.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        where: { attemptKind: 'automatic', sessionId: targetSessionId },
      });
      if (attempt !== null) {
        const result = await presentations.status(actor, targetSessionId, attempt.requestId);
        if (['succeeded', 'failed', 'cancelled'].includes(result.status)) return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Automatic suggestion request did not settle');
  }

  async function ageManualFence(targetSessionId = sessionId): Promise<void> {
    const old = new Date(Date.now() - 10_000);
    await prisma.questionDisplayState.update({
      data: { lastManualAttemptAcceptedAt: old },
      where: { sessionId: targetSessionId },
    });
    await prisma.questionEvidenceEvent.updateMany({
      data: { eventAt: old },
      where: { eventType: 'manual_next_requested', sessionId: targetSessionId },
    });
  }

  async function createSession(
    targetSessionId: string,
    streamId: string,
    sequenceNo: number,
  ): Promise<void> {
    await prisma.interviewSession.create({
      data: { createdBy: actorId, id: targetSessionId, projectId, sequenceNo, status: 'recording' },
    });
    await prisma.speakerStream.create({
      data: { closedAt: new Date(), id: streamId, sessionId: targetSessionId, status: 'closed' },
    });
  }

  async function nextSessionSequence(): Promise<number> {
    const latest = await prisma.interviewSession.findFirst({
      orderBy: { sequenceNo: 'desc' },
      select: { sequenceNo: true },
      where: { projectId },
    });
    return (latest?.sequenceNo ?? 0) + 1;
  }

  async function runAutomatic(targetSessionId: string, segmentId: string): Promise<void> {
    const internal = orchestration as unknown as {
      finalizedBuffer: { append(sessionId: string, finalizedSegmentId: string): void };
      runAutomatic(sessionId: string): Promise<void>;
    };
    internal.finalizedBuffer.append(targetSessionId, segmentId);
    await internal.runAutomatic(targetSessionId);
  }
});

function transcript(
  targetSessionId: string,
  streamId: string,
  startMs: number,
  originalText: string,
  originalSpeakerRole: 'elder' | 'interviewer',
): Prisma.TranscriptSegmentUncheckedCreateInput {
  return {
    endMs: startMs + 100,
    id: randomUUID(),
    ingestKey: `dev-007b-review-${randomUUID()}`,
    originalRoleAuthority: 'user_confirmed' as const,
    originalSpeakerRole,
    originalText,
    sessionId: targetSessionId,
    source: 'fixture' as const,
    speakerRoleRevision: 0,
    speakerStreamId: streamId,
    startMs,
  };
}

function fixtureCsv(version: string): string {
  return [
    'question_id,bank,topic,question_text,purpose,applicable_when,inapplicable_when,sensitivity,source_type,source_reference,license_status,license_reference,bank_version,enabled',
    `fixture-rapport-a,basic,童年环境,如果您愿意，可以先从小时候住过的地方讲起吗？,scene,stage.rapport,,low,synthetic_fixture,INTERNAL_DEMO_ONLY,fixture_only,NOT_PRODUCT_CONTENT,${version},true`,
    `fixture-rapport-b,basic,童年细节,小时候最常陪伴您的东西是什么？,detail,stage.rapport,,low,synthetic_fixture,INTERNAL_DEMO_ONLY,fixture_only,NOT_PRODUCT_CONTENT,${version},true`,
    `fixture-story-deep,deep,重要选择,那次选择之前您最犹豫的是什么？,choice,stage.story_depth;context.choice,,medium,synthetic_fixture,INTERNAL_DEMO_ONLY,fixture_only,NOT_PRODUCT_CONTENT,${version},true`,
  ].join('\n');
}
