import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PasswordService } from '../../apps/api/src/auth/password.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';

const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'Fictional-only-Password-42!';
const ACTOR_ID = '81000000-0000-4000-8000-000000000001';
const OTHER_ID = '81000000-0000-4000-8000-000000000002';
const ORDINARY_ID = '82000000-0000-4000-8000-000000000001';
const SECOND_ID = '82000000-0000-4000-8000-000000000002';
const RESTRICTED_ID = '82000000-0000-4000-8000-000000000003';
const SOFT_ID = '82000000-0000-4000-8000-000000000004';
const DELETED_ID = '82000000-0000-4000-8000-000000000005';
const UNASSIGNED_ID = '82000000-0000-4000-8000-000000000006';
const EVIDENCE_SESSION_ID = '83000000-0000-4000-8000-000000000006';
const AUDIO_ID = '84000000-0000-4000-8000-000000000001';
const ORDINARY_AUDIO_ID = '84000000-0000-4000-8000-000000000002';
type SupertestApp = Parameters<typeof request>[0];

interface ErrorBody {
  code: string;
}

interface LoginBody {
  csrf_token: string;
}

interface ProjectListBody {
  items: Array<{ projection: 'ordinary' | 'restricted' }>;
}

interface SessionListBody {
  items: Array<{ sequence_no: number } & Record<string, unknown>>;
  next_cursor: string | null;
}

describe('A1 assignment-safe home read model', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let actor: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;
  let csrf: string;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: ORIGIN,
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-home-cursor-signing-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-home-retention-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    const passwordHash = await new PasswordService().hash(PASSWORD);
    await prisma.user.createMany({
      data: [
        {
          displayName: '虚构倾听员 Home A',
          email: 'home-a@example.test',
          id: ACTOR_ID,
          passwordHash,
          role: 'interviewer',
        },
        {
          displayName: '虚构倾听员 Home B',
          email: 'home-b@example.test',
          id: OTHER_ID,
          passwordHash,
          role: 'interviewer',
        },
      ],
    });
    const projects = [
      [ORDINARY_ID, 'active', null],
      [SECOND_ID, 'active', null],
      [RESTRICTED_ID, 'restricted', null],
      [SOFT_ID, 'active', new Date('2026-08-12T00:00:00.000Z')],
      [DELETED_ID, 'deleted', null],
      [UNASSIGNED_ID, 'active', null],
    ] as const;
    for (const [id, status, deletedAt] of projects) {
      await prisma.elderProject.create({
        data: {
          createdBy: ACTOR_ID,
          deletedAt,
          displayName: `不得泄漏-${id}`,
          id,
          status,
        },
      });
    }
    await prisma.projectAssignment.createMany({
      data: [ORDINARY_ID, SECOND_ID, RESTRICTED_ID, SOFT_ID, DELETED_ID].map((projectId) => ({
        projectId,
        userId: ACTOR_ID,
      })),
    });
    await prisma.projectAssignment.create({ data: { projectId: UNASSIGNED_ID, userId: OTHER_ID } });
    const sameCreatedAt = new Date('2026-08-12T08:00:00.000Z');
    await prisma.interviewSession.createMany({
      data: [1, 2, 3].map((sequenceNo) => ({
        createdAt: sameCreatedAt,
        createdBy: ACTOR_ID,
        id: `83000000-0000-4000-8000-00000000000${String(sequenceNo)}`,
        projectId: ORDINARY_ID,
        sequenceNo,
        status: sequenceNo === 1 ? ('completed' as const) : ('created' as const),
      })),
    });
    await prisma.audioObject.create({
      data: {
        chunkCount: 1,
        completedAt: new Date('2026-08-12T08:10:00.000Z'),
        createdBy: ACTOR_ID,
        id: ORDINARY_AUDIO_ID,
        manifestChecksum: 'b'.repeat(64),
        mimeType: 'audio/webm;codecs=opus',
        projectId: ORDINARY_ID,
        purpose: 'interview',
        sessionId: '83000000-0000-4000-8000-000000000001',
        status: 'complete',
        totalSizeBytes: 128,
      },
    });
    await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: ORDINARY_AUDIO_ID,
        audioStreamId: '86000000-0000-4000-8000-000000000001',
        generationNo: 1,
        sessionId: '83000000-0000-4000-8000-000000000001',
        status: 'stopped',
        stoppedAt: new Date('2026-08-12T08:10:00.000Z'),
        timelineOffsetMs: 0,
      },
    });
    await prisma.sessionFinalization.create({
      data: {
        audioObjectId: ORDINARY_AUDIO_ID,
        audioStatus: 'complete',
        captureEndedAt: new Date('2026-08-12T08:10:00.000Z'),
        commitmentsChecksum: 'c'.repeat(64),
        createdBy: ACTOR_ID,
        expectedChunkCount: 1,
        failureCode: 'PROVIDER_PRIVATE_FAILURE',
        sessionId: '83000000-0000-4000-8000-000000000001',
        stopRequestId: '85000000-0000-4000-8000-000000000003',
        transcriptStatus: 'drained',
      },
    });
    await prisma.interviewSession.create({
      data: {
        createdBy: ACTOR_ID,
        id: EVIDENCE_SESSION_ID,
        projectId: UNASSIGNED_ID,
        sequenceNo: 1,
        status: 'stopping',
      },
    });
    await prisma.audioObject.create({
      data: {
        createdBy: ACTOR_ID,
        id: AUDIO_ID,
        mimeType: 'audio/webm;codecs=opus',
        projectId: UNASSIGNED_ID,
        purpose: 'interview',
        sessionId: EVIDENCE_SESSION_ID,
      },
    });
    await prisma.sessionFinalization.create({
      data: {
        audioObjectId: AUDIO_ID,
        captureEndedAt: new Date('2026-08-12T08:10:00.000Z'),
        commitmentsChecksum: 'a'.repeat(64),
        createdBy: ACTOR_ID,
        expectedChunkCount: 1,
        sessionId: EVIDENCE_SESSION_ID,
        stopRequestId: '85000000-0000-4000-8000-000000000001',
      },
    });
    const server = app.getHttpServer() as SupertestApp;
    actor = request.agent(server);
    const login = await actor
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'home-a@example.test', password: PASSWORD });
    expect(login.status).toBe(200);
    csrf = (login.body as LoginBody).csrf_token;
    other = request.agent(server);
    expect(
      (
        await other
          .post('/api/v1/auth/login')
          .set('Origin', ORIGIN)
          .send({ email: 'home-b@example.test', password: PASSWORD })
      ).status,
    ).toBe(200);
  });

  afterAll(async () => {
    await prisma.sessionCaptureGeneration.deleteMany({
      where: { audioObjectId: ORDINARY_AUDIO_ID },
    });
    await prisma.sessionFinalization.deleteMany({
      where: { sessionId: { in: [EVIDENCE_SESSION_ID, '83000000-0000-4000-8000-000000000001'] } },
    });
    await prisma.audioObject.deleteMany({ where: { id: { in: [AUDIO_ID, ORDINARY_AUDIO_ID] } } });
    await prisma.interviewSession.deleteMany({
      where: {
        projectId: {
          in: [ORDINARY_ID, SECOND_ID, RESTRICTED_ID, SOFT_ID, DELETED_ID, UNASSIGNED_ID],
        },
      },
    });
    await prisma.projectAssignment.deleteMany({
      where: {
        projectId: {
          in: [ORDINARY_ID, SECOND_ID, RESTRICTED_ID, SOFT_ID, DELETED_ID, UNASSIGNED_ID],
        },
      },
    });
    await prisma.elderProject.deleteMany({
      where: {
        id: { in: [ORDINARY_ID, SECOND_ID, RESTRICTED_ID, SOFT_ID, DELETED_ID, UNASSIGNED_ID] },
      },
    });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: [ACTOR_ID, OTHER_ID] } },
    });
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: ACTOR_ID } });
    await prisma.authSession.deleteMany({ where: { userId: { in: [ACTOR_ID, OTHER_ID] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ACTOR_ID, OTHER_ID] } } });
    await app.close();
  });

  it('returns ordinary projects and a closed restricted projection without hidden projects', async () => {
    const response = await actor.get('/api/v1/projects').set('Origin', ORIGIN);
    expect(response.status).toBe(200);
    const body = response.body as ProjectListBody;
    expect(body.items).toHaveLength(3);
    const restricted = body.items.find((item) => item.projection === 'restricted');
    expect(restricted).toEqual({
      display_label: '受限项目',
      project_id: RESTRICTED_ID,
      projection: 'restricted',
      status: 'restricted',
      status_label: '当前不可访问',
    });
    expect(JSON.stringify(body)).not.toContain('不得泄漏-82000000-0000-4000-8000-000000000003');
    expect(JSON.stringify(body)).not.toContain(SOFT_ID);
    expect(JSON.stringify(body)).not.toContain(DELETED_ID);
    expect(JSON.stringify(body)).not.toContain(UNASSIGNED_ID);
  });

  it('uses signed project-bound stable pagination and a strict field whitelist', async () => {
    const first = await actor
      .get(`/api/v1/projects/${ORDINARY_ID}/sessions?limit=2`)
      .set('Origin', ORIGIN);
    expect(first.status).toBe(200);
    const firstBody = first.body as SessionListBody;
    expect(firstBody.items.map((item) => item.sequence_no)).toEqual([3, 2]);
    expect(Object.keys(firstBody.items[0] ?? {}).sort()).toEqual(
      [
        'capture',
        'capture_failure_code',
        'created_at',
        'duration_seconds',
        'ended_at',
        'finalization',
        'home_state',
        'id',
        'primary_action',
        'project_id',
        'review_access',
        'sequence_no',
        'started_at',
        'status',
      ].sort(),
    );
    const second = await actor
      .get(
        `/api/v1/projects/${ORDINARY_ID}/sessions?limit=2&cursor=${String(firstBody.next_cursor)}`,
      )
      .set('Origin', ORIGIN);
    expect(second.status).toBe(200);
    const secondBody = second.body as SessionListBody;
    expect(secondBody.items.map((item) => item.sequence_no)).toEqual([1]);
    const completed = secondBody.items[0];
    expect(completed?.capture).toEqual({ status: 'stopped' });
    expect(Object.keys((completed?.finalization ?? {}) as Record<string, unknown>).sort()).toEqual(
      [
        'failure_code',
        'manifest_checksum',
        'recording_status',
        'transcript_status',
        'upload_status',
      ].sort(),
    );
    expect((completed?.finalization as Record<string, unknown>).failure_code).toBe(
      'FINALIZATION_INTERNAL_FAILURE',
    );
    const canonical = await actor
      .get('/api/v1/sessions/83000000-0000-4000-8000-000000000001')
      .set('Origin', ORIGIN);
    expect(canonical.status).toBe(200);
    expect((canonical.body as Record<string, Record<string, unknown>>).finalization).toHaveProperty(
      'total_size_bytes',
      128,
    );
    const unassignedActor = await other
      .get('/api/v1/sessions/83000000-0000-4000-8000-000000000001')
      .set('Origin', ORIGIN);
    expect([403, 404]).toContain(unassignedActor.status);
    expect((unassignedActor.body as Record<string, unknown>).finalization).toBeUndefined();
    expect(JSON.stringify(completed)).not.toContain('PROVIDER_PRIVATE_FAILURE');
    expect(JSON.stringify(completed)).not.toContain('object_key');
    const tampered = `${String(firstBody.next_cursor).slice(0, -1)}x`;
    const tamperedResponse = await actor
      .get(`/api/v1/projects/${ORDINARY_ID}/sessions?limit=2&cursor=${tampered}`)
      .set('Origin', ORIGIN);
    expect((tamperedResponse.body as ErrorBody).code).toBe('INVALID_SESSION_CURSOR');
    const crossProject = await actor
      .get(`/api/v1/projects/${SECOND_ID}/sessions?limit=2&cursor=${String(firstBody.next_cursor)}`)
      .set('Origin', ORIGIN);
    expect(crossProject.status).toBe(422);
    expect((crossProject.body as ErrorBody).code).toBe('INVALID_SESSION_CURSOR');
    const assignment = await prisma.projectAssignment.findFirstOrThrow({
      where: { projectId: ORDINARY_ID, revokedAt: null, userId: ACTOR_ID },
    });
    await prisma.projectAssignment.update({
      data: { revokedAt: new Date() },
      where: { id: assignment.id },
    });
    try {
      const drifted = await actor
        .get(
          `/api/v1/projects/${ORDINARY_ID}/sessions?limit=2&cursor=${String(firstBody.next_cursor)}`,
        )
        .set('Origin', ORIGIN);
      expect(drifted.status).toBe(403);
      expect((drifted.body as Record<string, unknown>).items).toBeUndefined();
    } finally {
      await prisma.projectAssignment.update({
        data: { revokedAt: null },
        where: { id: assignment.id },
      });
    }
  });

  it('fails ordinary restricted and creator-only deep links closed while preserving evidence seam', async () => {
    for (const path of [
      `/api/v1/projects/${RESTRICTED_ID}`,
      `/api/v1/projects/${RESTRICTED_ID}/service-terms`,
      `/api/v1/projects/${RESTRICTED_ID}/consents`,
      `/api/v1/projects/${RESTRICTED_ID}/sessions`,
    ]) {
      const response = await actor.get(path).set('Origin', ORIGIN);
      expect([403, 404]).toContain(response.status);
      expect(JSON.stringify(response.body as unknown)).not.toContain('不得泄漏');
    }
    const ordinarySession = await actor
      .get(`/api/v1/sessions/${EVIDENCE_SESSION_ID}`)
      .set('Origin', ORIGIN);
    expect(ordinarySession.status).toBe(403);
    expect((ordinarySession.body as Record<string, unknown>).project_id).toBeUndefined();

    const replayRequestId = '85000000-0000-4000-8000-000000000002';
    await prisma.idempotencyRecord.create({
      data: {
        action: 'interview_session.recover:reconcile',
        actorId: ACTOR_ID,
        requestId: replayRequestId,
        responsePayload: {
          created_at: '2026-08-12T08:00:00.000Z',
          created_by: ACTOR_ID,
          id: EVIDENCE_SESSION_ID,
          project_id: UNASSIGNED_ID,
          sequence_no: 1,
          started_at: null,
          status: 'stopping',
          updated_at: '2026-08-12T08:10:00.000Z',
        },
        targetId: EVIDENCE_SESSION_ID,
        targetType: 'interview_session',
      },
    });
    const restrictedReplay = await actor
      .post(`/api/v1/sessions/${EVIDENCE_SESSION_ID}/recover`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'reconcile', request_id: replayRequestId });
    expect(restrictedReplay.status).toBe(200);
    expect((restrictedReplay.body as Record<string, unknown>).project_id).toBeUndefined();
    expect((restrictedReplay.body as Record<string, unknown>).session_id).toBe(EVIDENCE_SESSION_ID);

    const evidence = await actor
      .get(`/api/v1/sessions/${EVIDENCE_SESSION_ID}/evidence-finalization`)
      .set('Origin', ORIGIN);
    expect(evidence.status).toBe(200);
    const evidenceBody = evidence.body as Record<string, unknown>;
    expect(Object.keys(evidenceBody).sort()).toEqual(
      [
        'audio_object_id',
        'expected_chunk_count',
        'failure_code',
        'manifest_checksum',
        'recording_status',
        'session_id',
        'session_status',
        'upload_status',
        'uploaded_chunk_count',
      ].sort(),
    );
    expect(evidenceBody.project_id).toBeUndefined();
    expect(evidenceBody.created_by).toBeUndefined();
    expect(evidenceBody.primary_action).toBeUndefined();
    const deniedEvidence = await other
      .get(`/api/v1/sessions/${EVIDENCE_SESSION_ID}/evidence-finalization`)
      .set('Origin', ORIGIN);
    expect(deniedEvidence.status).toBe(404);
    expect((deniedEvidence.body as Record<string, unknown>).session_id).toBeUndefined();
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'evidence_finalization.read',
          actorId: ACTOR_ID,
          entityId: EVIDENCE_SESSION_ID,
        },
      }),
    ).toBe(2);
  });
});
