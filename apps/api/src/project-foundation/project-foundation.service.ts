import type {
  ConsentResponse,
  CreateConsentRequest,
  CreateProjectRequest,
  CreateServiceTermRequest,
  DeviceCheckRequest,
  InterviewSessionResponse,
  ProjectListResponse,
  ProjectResponse,
  ServiceTermResponse,
  StartSessionRequest,
} from '@elder-interview/contracts';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { AudioIntegrityService } from '../audio/audio-integrity.service.js';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { IdempotencyRecord, Prisma } from '../generated/prisma/client.js';
import { RealtimeRuntimeService } from '../realtime-transcription/realtime-runtime.service.js';
import { evaluateInterviewStartGate } from './interview-start-policy.js';
import {
  mapConsent,
  mapInterviewSession,
  mapProject,
  mapProjectListOrdinary,
  mapProjectListRestricted,
  mapServiceTerm,
} from './project.mapper.js';
import { ProjectAccessService, type ProjectAccessSnapshot } from './project-access.service.js';
import { SessionSnapshotService } from './session-snapshot.service.js';

interface IdempotencyBinding {
  action: string;
  actorId: string;
  targetId: string;
  targetType: string;
}

interface InterruptedCaptureTarget {
  audioStreamId: string;
  generationNo: number;
  sessionId: string;
}

@Injectable()
export class ProjectFoundationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly authorization: ResourceAuthorizationService,
    private readonly audioIntegrity: AudioIntegrityService,
    private readonly snapshots: SessionSnapshotService,
    private readonly runtime: RealtimeRuntimeService,
  ) {}

  public async createProject(
    actor: AuthPrincipal,
    input: CreateProjectRequest,
  ): Promise<ProjectResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    const project = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.elderProject.create({
        data: {
          approximateAge: input.approximate_age,
          birthYear: input.birth_year,
          createdBy: actor.id,
          currentCity: input.current_city,
          displayName: input.display_name,
          nativePlace: input.native_place,
        },
      });
      await transaction.projectAssignment.create({
        data: { assignmentRole: 'interviewer', projectId: created.id, userId: actor.id },
      });
      await transaction.auditLog.create({
        data: {
          action: 'project.create',
          actorId: actor.id,
          actorType: 'user',
          entityId: created.id,
          entityType: 'elder_project',
          metadata: {},
        },
      });
      return created;
    });
    return mapProject(project);
  }

  public async listProjects(actor: AuthPrincipal): Promise<ProjectListResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    const projects = await this.prisma.elderProject.findMany({
      orderBy: { updatedAt: 'desc' },
      where: {
        assignments: { some: { revokedAt: null, userId: actor.id } },
        deletedAt: null,
        status: { not: 'deleted' },
      },
    });
    return {
      items: projects.map((project) =>
        project.status === 'restricted'
          ? mapProjectListRestricted(project.id)
          : mapProjectListOrdinary(project),
      ),
    };
  }

  public async getProject(actor: AuthPrincipal, projectId: string): Promise<ProjectResponse> {
    await this.assertInterviewerProjectRead(actor, projectId);
    const project = await this.prisma.elderProject.findUniqueOrThrow({ where: { id: projectId } });
    return mapProject(project);
  }

  public async appendServiceTerm(
    actor: AuthPrincipal,
    projectId: string,
    input: CreateServiceTermRequest,
  ): Promise<ServiceTermResponse> {
    await this.assertInterviewerProject(actor, projectId);
    const term = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `project:${projectId}`);
      await this.assertActiveAssignment(transaction, projectId, actor.id);
      const now = new Date();
      await transaction.serviceTerm.updateMany({
        data: { supersededAt: now },
        where: { projectId, supersededAt: null },
      });
      const created = await transaction.serviceTerm.create({
        data: {
          currency: input.currency,
          effectiveFrom: now,
          estimatedSessionCount: input.estimated_session_count,
          expectedCurrentMinutes: input.expected_current_minutes,
          explainedAt: now,
          explainedBy: actor.id,
          includedMinutes: input.included_minutes,
          overtimePriceMinor: input.overtime_price_minor,
          overtimeUnitMinutes: input.overtime_unit_minutes,
          projectId,
        },
      });
      await this.refreshReady(transaction, projectId);
      await transaction.auditLog.create({
        data: {
          action: 'service_term.create',
          actorId: actor.id,
          actorType: 'user',
          entityId: created.id,
          entityType: 'service_term',
          metadata: { project_id: projectId },
        },
      });
      return created;
    });
    return mapServiceTerm(term);
  }

  public async listServiceTerms(
    actor: AuthPrincipal,
    projectId: string,
  ): Promise<ServiceTermResponse[]> {
    await this.assertInterviewerProjectRead(actor, projectId);
    return (
      await this.prisma.serviceTerm.findMany({
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
        where: { projectId },
      })
    ).map(mapServiceTerm);
  }

  public async appendConsent(
    actor: AuthPrincipal,
    projectId: string,
    input: CreateConsentRequest,
  ): Promise<ConsentResponse> {
    await this.assertInterviewerProject(actor, projectId);
    const consent = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `project:${projectId}`);
      await this.assertActiveAssignment(transaction, projectId, actor.id);
      if (input.consent_method === 'recorded_verbal') {
        await this.audioIntegrity.verifyCompleteConsentObject(
          transaction,
          projectId,
          input.consent_audio_object_id ?? '',
        );
      }
      const previous = await transaction.consentRecord.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { consentType: 'recording_transcription_ai', projectId },
      });
      const wallClock = new Date();
      const createdAt =
        previous !== null && previous.createdAt >= wallClock
          ? new Date(previous.createdAt.getTime() + 1)
          : wallClock;
      const created = await transaction.consentRecord.create({
        data: {
          consentAudioObjectId: input.consent_audio_object_id,
          consentMethod: input.consent_method,
          consentTextVersion: input.consent_text_version,
          consentType: input.consent_type,
          consentedAt: new Date(input.consented_at),
          createdAt,
          createdBy: actor.id,
          projectId,
          status: 'valid',
        },
      });
      await transaction.elderProject.update({
        data: { aiPolicyRevision: { increment: 1 } },
        where: { id: projectId },
      });
      await this.refreshReady(transaction, projectId);
      await transaction.auditLog.create({
        data: {
          action: 'consent.create',
          actorId: actor.id,
          actorType: 'user',
          entityId: created.id,
          entityType: 'consent_record',
          metadata: { consent_type: input.consent_type, project_id: projectId },
        },
      });
      return created;
    });
    return mapConsent(consent);
  }

  public async listConsents(actor: AuthPrincipal, projectId: string): Promise<ConsentResponse[]> {
    await this.assertInterviewerProjectRead(actor, projectId);
    return (
      await this.prisma.consentRecord.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { projectId },
      })
    ).map(mapConsent);
  }

  public async revokeConsent(
    actor: AuthPrincipal,
    consentId: string,
    requestId: string,
  ): Promise<ConsentResponse> {
    const binding: IdempotencyBinding = {
      action: 'consent.revoke',
      actorId: actor.id,
      targetId: consentId,
      targetType: 'consent_record',
    };
    const existing = await this.prisma.consentRecord.findUnique({ where: { id: consentId } });
    if (existing === null) throw this.notFound();
    await this.assertInterviewerProject(actor, existing.projectId);
    const replay = await this.findReplay<ConsentResponse>(requestId, binding);
    if (replay !== null) {
      const interruptedCaptures = await this.replayedInterruptedCaptures(requestId);
      interruptedCaptures.forEach(({ audioStreamId, sessionId }) => {
        this.runtime.interruptCapture(sessionId, audioStreamId);
      });
      return replay;
    }
    const result = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `request:${requestId}`);
      const repeated = await this.findReplayInTransaction<ConsentResponse>(
        transaction,
        requestId,
        binding,
      );
      if (repeated !== null) return { interruptedCaptures: [], response: repeated };
      await this.lock(transaction, `project:${existing.projectId}`);
      const endingSessions = await transaction.interviewSession.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, status: true },
        where: {
          projectId: existing.projectId,
          status: { in: ['recording', 'reconnecting', 'stopping', 'processing', 'interrupted'] },
        },
      });
      for (const session of endingSessions) await this.lock(transaction, `session:${session.id}`);
      const endingAudio = await transaction.audioObject.findMany({
        orderBy: { id: 'asc' },
        select: { id: true },
        where: {
          projectId: existing.projectId,
          sessionId: { in: endingSessions.map(({ id }) => id) },
        },
      });
      for (const audio of endingAudio) await this.lock(transaction, `audio:${audio.id}`);
      await this.lock(transaction, `consent:${consentId}`);
      const consent = await transaction.consentRecord.findUnique({ where: { id: consentId } });
      if (consent === null) throw this.notFound();
      await this.assertActiveAssignment(transaction, consent.projectId, actor.id);
      const latest = await transaction.consentRecord.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { consentType: 'recording_transcription_ai', projectId: consent.projectId },
      });
      if (latest?.id !== consent.id || consent.status !== 'valid' || consent.revokedAt !== null) {
        throw new ConflictException({
          code: 'CONSENT_NOT_CURRENT',
          details: {},
          message: 'Only the current valid consent can be revoked',
        });
      }
      const now = new Date();
      const revoked = await transaction.consentRecord.update({
        data: { revokedAt: now, status: 'revoked' },
        where: { id: consent.id },
      });
      const project = await transaction.elderProject.findUniqueOrThrow({
        where: { id: consent.projectId },
      });
      await transaction.elderProject.update({
        data: {
          aiPolicyRevision: { increment: 1 },
          status: 'restricted',
          statusBeforeRestriction:
            project.status === 'restricted' ? project.statusBeforeRestriction : project.status,
        },
        where: { id: project.id },
      });
      const interruptedCaptures: InterruptedCaptureTarget[] = [];
      for (const session of endingSessions) {
        const affectedCapture = await transaction.sessionCaptureGeneration.findFirst({
          orderBy: { generationNo: 'desc' },
          where: { sessionId: session.id },
        });
        if (affectedCapture !== null) {
          interruptedCaptures.push({
            audioStreamId: affectedCapture.audioStreamId,
            generationNo: affectedCapture.generationNo,
            sessionId: session.id,
          });
        }
        if (affectedCapture !== null && ['preparing', 'active'].includes(affectedCapture.status)) {
          await transaction.sessionCaptureGeneration.update({
            data: {
              interruptedAt: now,
              interruptionReason: 'auth_lost',
              status: 'interrupted',
            },
            where: { id: affectedCapture.id },
          });
        }
        await transaction.interviewSession.updateMany({
          data: { status: 'interrupted' },
          where: { id: session.id, status: { in: ['recording', 'reconnecting'] } },
        });
      }
      const response = mapConsent(revoked);
      await transaction.auditLog.create({
        data: {
          action: 'consent.revoke',
          actorId: actor.id,
          actorType: 'user',
          entityId: revoked.id,
          entityType: 'consent_record',
          metadata: {
            interrupted_captures: interruptedCaptures.map(
              ({ audioStreamId, generationNo, sessionId }) => ({
                audio_stream_id: audioStreamId,
                generation_no: generationNo,
                session_id: sessionId,
              }),
            ),
            project_id: consent.projectId,
          },
          requestId,
        },
      });
      await this.writeIdempotency(transaction, requestId, binding, response);
      return { interruptedCaptures, response };
    });
    result.interruptedCaptures.forEach(({ audioStreamId, sessionId }) => {
      this.runtime.interruptCapture(sessionId, audioStreamId);
    });
    return result.response;
  }

  public async createSession(
    actor: AuthPrincipal,
    projectId: string,
  ): Promise<InterviewSessionResponse> {
    const snapshot = await this.assertInterviewerProject(actor, projectId);
    if (!['draft', 'ready', 'active'].includes(snapshot.status)) throw this.projectNotStartable();
    const session = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `project:${projectId}`);
      await this.assertActiveAssignment(transaction, projectId, actor.id);
      const project = await transaction.elderProject.findUnique({ where: { id: projectId } });
      if (
        project === null ||
        project.deletedAt !== null ||
        !['draft', 'ready', 'active'].includes(project.status)
      ) {
        throw this.projectNotStartable();
      }
      const last = await transaction.interviewSession.findFirst({
        orderBy: { sequenceNo: 'desc' },
        select: { sequenceNo: true },
        where: { projectId },
      });
      const created = await transaction.interviewSession.create({
        data: { createdBy: actor.id, projectId, sequenceNo: (last?.sequenceNo ?? 0) + 1 },
      });
      await transaction.auditLog.create({
        data: {
          action: 'interview_session.create',
          actorId: actor.id,
          actorType: 'user',
          entityId: created.id,
          entityType: 'interview_session',
          metadata: { project_id: projectId },
        },
      });
      return created;
    });
    return mapInterviewSession(session);
  }

  public async getSession(
    actor: AuthPrincipal,
    sessionId: string,
  ): Promise<InterviewSessionResponse> {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (session === null) throw this.notFound();
    await this.assertInterviewerProjectRead(actor, session.projectId);
    return mapInterviewSession(session);
  }

  public async deviceCheck(
    actor: AuthPrincipal,
    sessionId: string,
    input: DeviceCheckRequest,
  ): Promise<InterviewSessionResponse> {
    const existing = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (existing === null) throw this.notFound();
    await this.assertInterviewerProject(actor, existing.projectId);
    if (input.microphone_permission !== 'granted' || !input.input_detected) {
      throw new UnprocessableEntityException({
        code: 'DEVICE_CHECK_FAILED',
        details: {},
        message: 'Microphone permission and input are required',
      });
    }
    const session = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `session:${sessionId}`);
      const current = await transaction.interviewSession.findUnique({ where: { id: sessionId } });
      if (current === null) throw this.notFound();
      await this.assertActiveAssignment(transaction, current.projectId, actor.id);
      if (current.status === 'device_check') return current;
      if (current.status !== 'created') throw this.invalidSessionTransition();
      return transaction.interviewSession.update({
        data: { status: 'device_check' },
        where: { id: sessionId },
      });
    });
    return mapInterviewSession(session);
  }

  public async startSession(
    actor: AuthPrincipal,
    sessionId: string,
    input: StartSessionRequest,
  ): Promise<InterviewSessionResponse> {
    const binding: IdempotencyBinding = {
      action: 'interview_session.start',
      actorId: actor.id,
      targetId: sessionId,
      targetType: 'interview_session',
    };
    const existing = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (existing === null) throw this.notFound();
    await this.assertInterviewerProject(actor, existing.projectId);
    const replay = await this.findReplay<InterviewSessionResponse>(input.request_id, binding);
    if (replay !== null) {
      await this.assertStartReplay(replay, input);
      return replay;
    }
    const started = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `request:${input.request_id}`);
      const repeated = await this.findReplayInTransaction<InterviewSessionResponse>(
        transaction,
        input.request_id,
        binding,
      );
      if (repeated !== null) {
        await this.assertStartReplay(repeated, input, transaction);
        return repeated;
      }
      await this.lock(transaction, `project:${existing.projectId}`);
      await this.lock(transaction, `session:${sessionId}`);
      const session = await transaction.interviewSession.findUnique({ where: { id: sessionId } });
      if (session === null) throw this.notFound();
      await this.assertActiveAssignment(transaction, session.projectId, actor.id);
      const project = await transaction.elderProject.findUniqueOrThrow({
        where: { id: session.projectId },
      });
      const serviceTerm = await transaction.serviceTerm.findFirst({
        where: { projectId: project.id, supersededAt: null },
      });
      const consent = await transaction.consentRecord.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { consentType: 'recording_transcription_ai', projectId: project.id },
      });
      const gate = evaluateInterviewStartGate({
        allRequiredConsentsValid: consent?.status === 'valid' && consent.revokedAt === null,
        projectStatus: project.status,
        serviceExplanationConfirmed: serviceTerm !== null,
        sessionStatus: session.status,
      });
      if (!gate.allowed) {
        throw new ConflictException({
          code: gate.reason.toUpperCase(),
          details: {},
          message: 'Interview start gate is not satisfied',
        });
      }
      const now = new Date();
      await transaction.interviewSession.update({
        data: { startedAt: now, status: 'recording' },
        where: { id: session.id },
      });
      const audio = await transaction.audioObject.create({
        data: {
          createdBy: actor.id,
          mimeType: input.mime_type,
          projectId: project.id,
          purpose: 'interview',
          sessionId: session.id,
        },
      });
      await transaction.sessionCaptureGeneration.create({
        data: {
          audioObjectId: audio.id,
          audioStreamId: input.audio_stream_id,
          generationNo: 0,
          sessionId: session.id,
          timelineOffsetMs: 0,
        },
      });
      if (project.status === 'ready') {
        await transaction.elderProject.update({
          data: { status: 'active' },
          where: { id: project.id },
        });
      }
      const response = await this.snapshots.read(session.id, transaction);
      await transaction.auditLog.create({
        data: {
          action: 'interview_session.start',
          actorId: actor.id,
          actorType: 'user',
          entityId: session.id,
          entityType: 'interview_session',
          metadata: {
            audio_stream_id: input.audio_stream_id,
            mime_type: input.mime_type,
            project_id: project.id,
          },
          requestId: input.request_id,
        },
      });
      await this.writeIdempotency(transaction, input.request_id, binding, response);
      return response;
    });
    return started;
  }

  private async assertStartReplay(
    snapshot: InterviewSessionResponse,
    input: StartSessionRequest,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    if (snapshot.capture?.audio_stream_id !== input.audio_stream_id) {
      throw this.idempotencyPayloadMismatch();
    }
    const audio = await db.audioObject.findUnique({
      where: { id: snapshot.capture.audio_object_id },
    });
    if (audio?.mimeType !== input.mime_type) throw this.idempotencyPayloadMismatch();
  }

  private async replayedInterruptedCaptures(
    requestId: string,
  ): Promise<InterruptedCaptureTarget[]> {
    const audit = await this.prisma.auditLog.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { metadata: true },
      where: { action: 'consent.revoke', requestId },
    });
    if (
      audit === null ||
      typeof audit.metadata !== 'object' ||
      audit.metadata === null ||
      Array.isArray(audit.metadata)
    ) {
      return [];
    }
    const captures = audit.metadata.interrupted_captures;
    if (!Array.isArray(captures)) return [];
    return captures.flatMap((value) => {
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        typeof value.audio_stream_id !== 'string' ||
        typeof value.generation_no !== 'number' ||
        typeof value.session_id !== 'string'
      ) {
        return [];
      }
      return [
        {
          audioStreamId: value.audio_stream_id,
          generationNo: value.generation_no,
          sessionId: value.session_id,
        },
      ];
    });
  }

  private async refreshReady(
    transaction: Prisma.TransactionClient,
    projectId: string,
  ): Promise<void> {
    const project = await transaction.elderProject.findUniqueOrThrow({ where: { id: projectId } });
    if (project.status !== 'draft') return;
    const serviceTerm = await transaction.serviceTerm.findFirst({
      where: { projectId, supersededAt: null },
    });
    const consent = await transaction.consentRecord.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { consentType: 'recording_transcription_ai', projectId },
    });
    if (serviceTerm !== null && consent?.status === 'valid' && consent.revokedAt === null) {
      await transaction.elderProject.update({
        data: { status: 'ready' },
        where: { id: projectId },
      });
    }
  }

  private async assertInterviewerProject(
    actor: AuthPrincipal,
    projectId: string,
  ): Promise<ProjectAccessSnapshot> {
    await this.authorization.assertRole(actor, ['interviewer']);
    return this.access.assertCanAccess(actor, projectId);
  }

  private async assertInterviewerProjectRead(
    actor: AuthPrincipal,
    projectId: string,
  ): Promise<ProjectAccessSnapshot> {
    await this.authorization.assertRole(actor, ['interviewer']);
    return this.access.assertCanReadOrdinary(actor, projectId);
  }

  private async assertActiveAssignment(
    transaction: Prisma.TransactionClient,
    projectId: string,
    userId: string,
  ): Promise<void> {
    const assignment = await transaction.projectAssignment.findFirst({
      where: { projectId, revokedAt: null, userId },
    });
    if (assignment === null) {
      throw new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'Access denied' });
    }
  }

  private async findReplay<T>(requestId: string, binding: IdempotencyBinding): Promise<T | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({ where: { requestId } });
    return record === null ? null : (this.readReplay(record, binding) as T);
  }

  private async findReplayInTransaction<T>(
    transaction: Prisma.TransactionClient,
    requestId: string,
    binding: IdempotencyBinding,
  ): Promise<T | null> {
    const record = await transaction.idempotencyRecord.findUnique({ where: { requestId } });
    return record === null ? null : (this.readReplay(record, binding) as T);
  }

  private readReplay(record: IdempotencyRecord, binding: IdempotencyBinding): unknown {
    if (
      record.action !== binding.action ||
      record.actorId !== binding.actorId ||
      record.targetType !== binding.targetType ||
      record.targetId !== binding.targetId
    ) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        details: {},
        message: 'Idempotency key is already bound to another operation',
      });
    }
    return record.responsePayload;
  }

  private async writeIdempotency(
    transaction: Prisma.TransactionClient,
    requestId: string,
    binding: IdempotencyBinding,
    response: ConsentResponse | InterviewSessionResponse,
  ): Promise<void> {
    await transaction.idempotencyRecord.create({
      data: {
        action: binding.action,
        actorId: binding.actorId,
        requestId,
        responsePayload: response as unknown as Prisma.InputJsonValue,
        targetId: binding.targetId,
        targetType: binding.targetType,
      },
    });
  }

  private async lock(transaction: Prisma.TransactionClient, value: string): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${value}, 0))`;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', details: {}, message: 'Resource not found' });
  }

  private projectNotStartable(): ConflictException {
    return new ConflictException({
      code: 'PROJECT_NOT_STARTABLE',
      details: {},
      message: 'Project cannot create an interview session',
    });
  }

  private invalidSessionTransition(): ConflictException {
    return new ConflictException({
      code: 'INVALID_SESSION_TRANSITION',
      details: {},
      message: 'Interview session state does not allow this operation',
    });
  }

  private idempotencyPayloadMismatch(): ConflictException {
    return new ConflictException({
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      details: {},
      message: 'Idempotent request payload does not match the original request',
    });
  }
}
