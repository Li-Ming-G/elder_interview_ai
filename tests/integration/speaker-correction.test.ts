import { randomUUID } from 'node:crypto';
import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthPrincipal } from '../../apps/api/src/auth/auth.types.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { PasswordService } from '../../apps/api/src/auth/password.service.js';
import { SpeakerCorrectionService } from '../../apps/api/src/project-foundation/speaker-correction.service.js';
import type {
  ElderProject,
  InterviewSession,
  SpeakerStream,
  TranscriptSegment,
} from '../../apps/api/src/generated/prisma/client.js';

interface Fixture {
  actor: AuthPrincipal;
  project: ElderProject;
  session: InterviewSession;
  stream: SpeakerStream;
}

describe('speaker correction producer seam', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let corrections: SpeakerCorrectionService;
  let fixture: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-speaker-correction-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-speaker-correction-retention-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    corrections = app.get(SpeakerCorrectionService);
    await clean(prisma);
  });

  beforeEach(async () => {
    await clean(prisma);
    fixture = await createFixture(prisma);
  });

  afterAll(async () => {
    await clean(prisma);
    await app.close();
  });

  it('atomically corrects one segment, preserves original evidence, and replays exactly once', async () => {
    const segment = await addSegment(prisma, fixture, 1_000, 'speaker_1', '原始证据正文');
    const request = {
      corrected_speaker_role: 'elder' as const,
      expected_speaker_role_revision: 0,
      request_id: randomUUID(),
    };
    const [first, replay] = await Promise.all([
      corrections.correctOne(fixture.actor, segment.id, request),
      corrections.correctOne(fixture.actor, segment.id, request),
    ]);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      speaker_role_revision: 1,
      segment: { effective_speaker_role: 'elder' },
    });
    const persisted = await prisma.transcriptSegment.findUniqueOrThrow({
      where: { id: segment.id },
    });
    expect(persisted).toMatchObject({
      contentKind: 'conversation',
      correctedBy: fixture.actor.id,
      correctedSpeakerRole: 'elder',
      originalRoleAuthority: 'unconfirmed',
      originalSpeakerRole: 'unknown',
      originalText: '原始证据正文',
      speakerProviderId: 'speaker_1',
      speakerRoleRevision: 1,
      speakerStreamId: fixture.stream.id,
    });
    expect(await prisma.speakerCorrectionOperation.count()).toBe(1);
    expect(await prisma.speakerCorrectionOperationSegment.count()).toBe(1);
    expect(await prisma.idempotencyRecord.count({ where: { requestId: request.request_id } })).toBe(
      1,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { requestId: request.request_id },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('原始证据正文');
    expect(JSON.stringify(audit.metadata)).not.toContain('speaker_1');
    expect(await prisma.speakerMapping.count()).toBe(0);

    await expect(
      corrections.correctOne(fixture.actor, segment.id, {
        ...request,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'SPEAKER_ROLE_VERSION_CONFLICT' } });
  });

  it('exposes the formal PATCH route behind auth, CSRF, assignment, and latest consent gates', async () => {
    const password = 'Fictional-C2-Password-42!';
    const passwordHash = await new PasswordService().hash(password);
    await prisma.user.update({ data: { passwordHash }, where: { id: fixture.actor.id } });
    const outsider = await prisma.user.create({
      data: {
        displayName: '虚构未分配用户',
        email: `${randomUUID()}@speaker-correction.example.test`,
        passwordHash,
        role: 'interviewer',
      },
    });
    const segment = await addSegment(prisma, fixture, 1_000, 'speaker_1');
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const assignedAgent = request.agent(server);
    const outsiderAgent = request.agent(server);
    const assignedLogin = await assignedAgent
      .post('/api/v1/auth/login')
      .set('Origin', 'http://127.0.0.1:4173')
      .send({
        email: (await prisma.user.findUniqueOrThrow({ where: { id: fixture.actor.id } })).email,
        password,
      });
    await outsiderAgent
      .post('/api/v1/auth/login')
      .set('Origin', 'http://127.0.0.1:4173')
      .send({ email: outsider.email, password });
    const input = {
      corrected_speaker_role: 'elder',
      expected_speaker_role_revision: 0,
      request_id: randomUUID(),
    };
    expect(
      await assignedAgent
        .patch(`/api/v1/transcripts/${segment.id}/speaker-role`)
        .set('Origin', 'http://127.0.0.1:4173')
        .send(input),
    ).toMatchObject({ status: 403, body: { code: 'INVALID_CSRF_TOKEN' } });
    const outsiderCsrfResponse = await outsiderAgent.get('/api/v1/auth/csrf');
    const outsiderCsrf = (outsiderCsrfResponse.body as { csrf_token: string }).csrf_token;
    expect(
      await outsiderAgent
        .patch(`/api/v1/transcripts/${segment.id}/speaker-role`)
        .set('Origin', 'http://127.0.0.1:4173')
        .set('X-CSRF-Token', outsiderCsrf)
        .send({ ...input, request_id: randomUUID() }),
    ).toMatchObject({ status: 403, body: { code: 'SPEAKER_ROLE_UPDATE_FORBIDDEN' } });
    const corrected = await assignedAgent
      .patch(`/api/v1/transcripts/${segment.id}/speaker-role`)
      .set('Origin', 'http://127.0.0.1:4173')
      .set('X-CSRF-Token', (assignedLogin.body as { csrf_token: string }).csrf_token)
      .send(input);
    const correctedBody = corrected.body as {
      operation_id: string;
      segment: { effective_speaker_role: string; id: string };
      speaker_role_revision: number;
    };
    expect(corrected.status).toBe(200);
    expect(correctedBody.operation_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(correctedBody).toMatchObject({
      segment: { effective_speaker_role: 'elder', id: segment.id },
      speaker_role_revision: 1,
    });
  });

  it('serializes different single-segment requests so one wins and one conflicts', async () => {
    const segment = await addSegment(prisma, fixture, 1_000, 'speaker_1');
    const results = await Promise.allSettled([
      corrections.correctOne(fixture.actor, segment.id, {
        corrected_speaker_role: 'elder',
        expected_speaker_role_revision: 0,
        request_id: randomUUID(),
      }),
      corrections.correctOne(fixture.actor, segment.id, {
        corrected_speaker_role: 'interviewer',
        expected_speaker_role_revision: 0,
        request_id: randomUUID(),
      }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await prisma.speakerCorrectionOperation.count()).toBe(1);
    expect(
      (await prisma.interviewSession.findUniqueOrThrow({ where: { id: fixture.session.id } }))
        .speakerRoleRevision,
    ).toBe(1);
  });

  it('persists stable complete preview membership and executes the included set atomically', async () => {
    const [start, , excluded, end] = await Promise.all([
      addSegment(prisma, fixture, 1_000, 'speaker_1'),
      addSegment(prisma, fixture, 2_000, 'speaker_1'),
      addSegment(prisma, fixture, 3_000, 'speaker_1'),
      addSegment(prisma, fixture, 4_000, 'speaker_1'),
    ]);
    await corrections.correctOne(fixture.actor, excluded.id, {
      corrected_speaker_role: 'interviewer',
      expected_speaker_role_revision: 0,
      request_id: randomUUID(),
    });
    const input = {
      corrected_speaker_role: 'elder' as const,
      exclude_individual_corrections: true as const,
      request_id: randomUUID(),
      segment_end_id: end.id,
      segment_start_id: start.id,
      speaker_provider_id: 'speaker_1',
      speaker_stream_id: fixture.stream.id,
    };
    const preview = await corrections.preview(fixture.actor, fixture.session.id, input);
    expect(preview).toMatchObject({
      candidate_segment_count: 4,
      excluded_segment_count: 1,
      segment_count: 3,
    });
    expect(await corrections.preview(fixture.actor, fixture.session.id, input)).toEqual(preview);
    const memberships = await prisma.speakerRemapPreviewSegment.findMany({
      orderBy: { createdAt: 'asc' },
      where: { speakerRemapPreviewId: preview.preview_id },
    });
    expect(memberships).toHaveLength(4);
    expect(
      memberships.find(({ transcriptSegmentId }) => transcriptSegmentId === excluded.id)
        ?.excludedIndividualCorrection,
    ).toBe(true);
    const executeInput = {
      preview_hash: preview.preview_hash,
      preview_id: preview.preview_id,
      request_id: randomUUID(),
    };
    const [executed, replay] = await Promise.all([
      corrections.execute(fixture.actor, fixture.session.id, executeInput),
      corrections.execute(fixture.actor, fixture.session.id, executeInput),
    ]);
    expect(replay).toEqual(executed);
    expect(executed).toMatchObject({ segment_count: 3, speaker_role_revision: 2 });
    const final = await prisma.transcriptSegment.findMany({ orderBy: { startMs: 'asc' } });
    expect(final.map(({ correctedSpeakerRole }) => correctedSpeakerRole)).toEqual([
      'elder',
      'elder',
      'interviewer',
      'elder',
    ]);
    expect(final[2]?.speakerRoleRevision).toBe(1);
    expect(
      await prisma.speakerCorrectionOperationSegment.count({
        where: { speakerCorrectionOperationId: executed.operation_id },
      }),
    ).toBe(3);
    expect(
      JSON.stringify(
        (await prisma.auditLog.findFirstOrThrow({ where: { requestId: executeInput.request_id } }))
          .metadata,
      ),
    ).not.toContain('原始');
  });

  it('rejects invalid endpoints and marks a preview stale after a late final or member drift', async () => {
    const [start, end] = await Promise.all([
      addSegment(prisma, fixture, 1_000, 'speaker_1'),
      addSegment(prisma, fixture, 4_000, 'speaker_1'),
    ]);
    const otherStream = await prisma.speakerStream.create({
      data: { closedAt: new Date(), sessionId: fixture.session.id, status: 'closed' },
    });
    const wrongEnd = await addSegment(
      prisma,
      { ...fixture, stream: otherStream },
      5_000,
      'speaker_1',
    );
    await expect(
      corrections.preview(fixture.actor, fixture.session.id, {
        corrected_speaker_role: 'elder',
        exclude_individual_corrections: true,
        request_id: randomUUID(),
        segment_end_id: wrongEnd.id,
        segment_start_id: start.id,
        speaker_provider_id: 'speaker_1',
        speaker_stream_id: fixture.stream.id,
      }),
    ).rejects.toMatchObject({ response: { code: 'SPEAKER_REMAP_RANGE_INVALID' } });
    const preview = await corrections.preview(fixture.actor, fixture.session.id, {
      corrected_speaker_role: 'elder',
      exclude_individual_corrections: true,
      request_id: randomUUID(),
      segment_end_id: end.id,
      segment_start_id: start.id,
      speaker_provider_id: 'speaker_1',
      speaker_stream_id: fixture.stream.id,
    });
    await addSegment(prisma, fixture, 2_000, 'speaker_1');
    await expect(
      corrections.execute(fixture.actor, fixture.session.id, {
        preview_hash: preview.preview_hash,
        preview_id: preview.preview_id,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'SPEAKER_REMAP_PREVIEW_STALE' } });
    expect(
      await prisma.speakerCorrectionOperation.count({ where: { operationType: 'batch' } }),
    ).toBe(0);
    expect(
      (await prisma.interviewSession.findUniqueOrThrow({ where: { id: fixture.session.id } }))
        .speakerRoleRevision,
    ).toBe(0);
  });

  it('rejects an endpoint that is itself a current single correction', async () => {
    const [start, end] = await Promise.all([
      addSegment(prisma, fixture, 1_000, 'speaker_1'),
      addSegment(prisma, fixture, 2_000, 'speaker_1'),
    ]);
    await corrections.correctOne(fixture.actor, start.id, {
      corrected_speaker_role: 'elder',
      expected_speaker_role_revision: 0,
      request_id: randomUUID(),
    });
    await expect(
      corrections.preview(fixture.actor, fixture.session.id, {
        corrected_speaker_role: 'interviewer',
        exclude_individual_corrections: true,
        request_id: randomUUID(),
        segment_end_id: end.id,
        segment_start_id: start.id,
        speaker_provider_id: 'speaker_1',
        speaker_stream_id: fixture.stream.id,
      }),
    ).rejects.toMatchObject({ response: { code: 'SPEAKER_REMAP_RANGE_INVALID' } });
    expect(await prisma.speakerRemapPreview.count()).toBe(0);
  });

  it('serializes different execute request IDs and revalidates authority after preview', async () => {
    const [start, end] = await Promise.all([
      addSegment(prisma, fixture, 1_000, 'speaker_1'),
      addSegment(prisma, fixture, 2_000, 'speaker_1'),
    ]);
    const preview = await corrections.preview(fixture.actor, fixture.session.id, {
      corrected_speaker_role: 'elder',
      exclude_individual_corrections: true,
      request_id: randomUUID(),
      segment_end_id: end.id,
      segment_start_id: start.id,
      speaker_provider_id: 'speaker_1',
      speaker_stream_id: fixture.stream.id,
    });
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId: fixture.project.id },
    });
    await expect(
      corrections.execute(fixture.actor, fixture.session.id, {
        preview_hash: preview.preview_hash,
        preview_id: preview.preview_id,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'SPEAKER_ROLE_UPDATE_FORBIDDEN' } });
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: null },
      where: { projectId: fixture.project.id },
    });
    const results = await Promise.allSettled([
      corrections.execute(fixture.actor, fixture.session.id, {
        preview_hash: preview.preview_hash,
        preview_id: preview.preview_id,
        request_id: randomUUID(),
      }),
      corrections.execute(fixture.actor, fixture.session.id, {
        preview_hash: preview.preview_hash,
        preview_id: preview.preview_id,
        request_id: randomUUID(),
      }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { response: { code: 'SPEAKER_REMAP_PREVIEW_STALE' } },
      status: 'rejected',
    });
    expect(
      await prisma.speakerCorrectionOperation.count({ where: { operationType: 'batch' } }),
    ).toBe(1);
    expect(await prisma.speakerCorrectionOperationSegment.count()).toBe(2);
  });

  it('fails closed for assignment, latest consent, restricted, and deleted project gates', async () => {
    const segment = await addSegment(prisma, fixture, 1_000, 'speaker_1');
    const attempt = (): Promise<unknown> =>
      corrections.correctOne(fixture.actor, segment.id, {
        corrected_speaker_role: 'elder',
        expected_speaker_role_revision: 0,
        request_id: randomUUID(),
      });
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId: fixture.project.id },
    });
    await expect(attempt()).rejects.toMatchObject({
      response: { code: 'SPEAKER_ROLE_UPDATE_FORBIDDEN' },
    });
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: null },
      where: { projectId: fixture.project.id },
    });
    await prisma.consentRecord.updateMany({
      data: { status: 'revoked', revokedAt: new Date() },
      where: { projectId: fixture.project.id },
    });
    await expect(attempt()).rejects.toMatchObject({
      response: { code: 'SPEAKER_ROLE_UPDATE_FORBIDDEN' },
    });
    await prisma.consentRecord.updateMany({
      data: { status: 'valid', revokedAt: null },
      where: { projectId: fixture.project.id },
    });
    await prisma.elderProject.update({
      data: { status: 'restricted' },
      where: { id: fixture.project.id },
    });
    await expect(attempt()).rejects.toMatchObject({
      response: { code: 'SPEAKER_ROLE_UPDATE_FORBIDDEN' },
    });
    await prisma.elderProject.update({
      data: { status: 'deleted', deletedAt: new Date() },
      where: { id: fixture.project.id },
    });
    await expect(attempt()).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(await prisma.speakerCorrectionOperation.count()).toBe(0);
  });
});

async function createFixture(prisma: PrismaService): Promise<Fixture> {
  const user = await prisma.user.create({
    data: {
      displayName: '虚构角色修正倾听员',
      email: `${randomUUID()}@speaker-correction.example.test`,
      passwordHash: 'test-only-not-a-real-password-hash',
      role: 'interviewer',
    },
  });
  const actor: AuthPrincipal = {
    displayName: user.displayName,
    id: user.id,
    role: user.role,
    sessionId: randomUUID(),
  };
  const project = await prisma.elderProject.create({
    data: {
      assignments: { create: { userId: user.id } },
      consents: {
        create: {
          consentMethod: 'electronic',
          consentTextVersion: 'test-v1',
          consentedAt: new Date(),
          createdBy: user.id,
          status: 'valid',
        },
      },
      createdBy: user.id,
      displayName: '虚构角色修正项目',
      status: 'active',
    },
  });
  const session = await prisma.interviewSession.create({
    data: { createdBy: user.id, projectId: project.id, sequenceNo: 1, status: 'recording' },
  });
  const stream = await prisma.speakerStream.create({
    data: { closedAt: new Date(), sessionId: session.id, status: 'closed' },
  });
  return { actor, project, session, stream };
}

async function addSegment(
  prisma: PrismaService,
  fixture: Fixture,
  startMs: number,
  speakerProviderId: string,
  originalText = `原始片段-${String(startMs)}`,
): Promise<TranscriptSegment> {
  return prisma.transcriptSegment.create({
    data: {
      endMs: startMs + 500,
      ingestKey: randomUUID(),
      originalText,
      sessionId: fixture.session.id,
      source: 'fixture',
      speakerProviderId,
      speakerStreamId: fixture.stream.id,
      startMs,
    },
  });
}

async function clean(prisma: PrismaService): Promise<void> {
  await prisma.idempotencyRecord.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.speakerCorrectionOperationSegment.deleteMany();
  await prisma.speakerCorrectionOperation.deleteMany();
  await prisma.speakerRemapPreviewSegment.deleteMany();
  await prisma.speakerRemapPreview.deleteMany();
  await prisma.speakerCalibrationAttemptSegment.deleteMany();
  await prisma.speakerCalibrationAttempt.deleteMany();
  await prisma.transcriptSegment.deleteMany();
  await prisma.speakerMapping.deleteMany();
  await prisma.speakerStream.deleteMany();
  await prisma.sessionFinalizationChunk.deleteMany();
  await prisma.sessionFinalization.deleteMany();
  await prisma.sessionCaptureGeneration.deleteMany();
  await prisma.audioChunk.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.audioObject.deleteMany();
  await prisma.interviewSession.deleteMany();
  await prisma.serviceTerm.deleteMany();
  await prisma.projectAssignment.deleteMany();
  await prisma.elderProject.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.user.deleteMany();
}
