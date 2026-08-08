import { createHash } from 'node:crypto';

import type {
  AudioChunkResponse,
  AudioManifestResponse,
  AudioObjectResponse,
  CompleteAudioObjectRequest,
  CreateAudioObjectRequest,
} from '@elder-interview/contracts';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AudioObject, IdempotencyRecord, Prisma } from '../generated/prisma/client.js';
import { AudioIntegrityService } from './audio-integrity.service.js';
import { canonicalAudioManifestChecksum } from './audio-manifest.js';
import { mapAudioChunk, mapAudioManifest, mapAudioObject } from './audio.mapper.js';
import type { AudioChunkInput } from './audio.validation.js';
import { AudioStorageObjectMissingError, AudioStorageProvider } from './audio-storage.provider.js';

interface IdempotencyBinding {
  action: string;
  actorId: string;
  targetId: string;
  targetType: string;
}

@Injectable()
export class AudioService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: ResourceAuthorizationService,
    private readonly integrity: AudioIntegrityService,
    @Inject(AudioStorageProvider) private readonly storage: AudioStorageProvider,
  ) {}

  public async createObject(
    actor: AuthPrincipal,
    projectId: string,
    input: CreateAudioObjectRequest,
  ): Promise<AudioObjectResponse> {
    await this.assertProjectAccess(actor, projectId);
    const binding = this.binding('audio_object.create', actor.id, 'elder_project', projectId);
    const replay = await this.findReplay<AudioObjectResponse>(input.request_id, binding);
    if (replay !== null) return replay;
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `request:${input.request_id}`);
      const repeated = await this.findReplayInTransaction<AudioObjectResponse>(
        transaction,
        input.request_id,
        binding,
      );
      if (repeated !== null) return repeated;
      await this.lock(transaction, `project:${projectId}`);
      if (input.session_id !== null) await this.lock(transaction, `session:${input.session_id}`);
      await this.assertActiveAssignment(transaction, projectId, actor.id);
      await this.assertCreateGate(transaction, projectId, input);
      const created = await transaction.audioObject.create({
        data: {
          createdBy: actor.id,
          mimeType: input.mime_type,
          projectId,
          purpose: input.purpose,
          sessionId: input.session_id,
        },
      });
      const response = mapAudioObject(created);
      await this.writeIdempotency(transaction, input.request_id, binding, response);
      return response;
    });
  }

  public async uploadChunk(
    actor: AuthPrincipal,
    audioObjectId: string,
    input: AudioChunkInput,
    bytes: Buffer,
  ): Promise<AudioChunkResponse> {
    const object = await this.findObjectForWrite(actor, audioObjectId);
    const binding = this.binding(
      `audio_chunk.upload:${String(input.sequenceNo)}`,
      actor.id,
      'audio_object',
      audioObjectId,
    );
    const replay = await this.findReplay<AudioChunkResponse>(input.requestId, binding);
    if (replay !== null) return replay;
    if (sha256(bytes) !== input.checksum) {
      throw new ConflictException({
        code: 'AUDIO_CHECKSUM_MISMATCH',
        details: {},
        message: 'Audio chunk checksum does not match the request body',
      });
    }
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `request:${input.requestId}`);
      const repeated = await this.findReplayInTransaction<AudioChunkResponse>(
        transaction,
        input.requestId,
        binding,
      );
      if (repeated !== null) return repeated;
      await this.lock(transaction, `project:${object.projectId}`);
      if (object.sessionId !== null) await this.lock(transaction, `session:${object.sessionId}`);
      await this.lock(transaction, `audio:${audioObjectId}`);
      const current = await transaction.audioObject.findUnique({ where: { id: audioObjectId } });
      if (current === null) throw this.notFound();
      await this.assertUploadAuthority(transaction, current, actor, input);
      await this.assertWritable(transaction, current);
      if (current.mimeType !== input.mimeType) throw this.chunkConflict();

      const objectKey = `${audioObjectId}/${String(input.sequenceNo)}.bin`;
      const existing = await transaction.audioChunk.findUnique({
        where: { audioObjectId_sequenceNo: { audioObjectId, sequenceNo: input.sequenceNo } },
      });
      if (
        existing !== null &&
        (existing.checksum !== input.checksum ||
          existing.endMs !== input.endMs ||
          existing.mimeType !== input.mimeType ||
          existing.objectKey !== objectKey ||
          existing.sizeBytes !== bytes.byteLength ||
          existing.startMs !== input.startMs ||
          existing.uploadStatus !== 'uploaded')
      ) {
        throw this.chunkConflict();
      }

      let stored;
      try {
        if (existing === null) {
          stored = await this.storage.putImmutable(objectKey, bytes);
        } else {
          try {
            stored = await this.storage.inspect(objectKey);
          } catch (error: unknown) {
            if (!(error instanceof AudioStorageObjectMissingError)) throw error;
            stored = await this.storage.putImmutable(objectKey, bytes);
          }
        }
      } catch {
        throw this.storageUnavailable();
      }
      if (stored.checksum !== input.checksum || stored.sizeBytes !== bytes.byteLength) {
        throw this.chunkConflict();
      }

      let response: AudioChunkResponse;
      if (existing !== null) {
        response = mapAudioChunk(existing);
      } else {
        const uploaded = await transaction.audioChunk.create({
          data: {
            audioObjectId,
            checksum: input.checksum,
            endMs: input.endMs,
            mimeType: input.mimeType,
            objectKey,
            sequenceNo: input.sequenceNo,
            sizeBytes: bytes.byteLength,
            startMs: input.startMs,
            uploadStatus: 'uploaded',
            uploadedAt: new Date(),
          },
        });
        if (current.status === 'initiated') {
          await transaction.audioObject.update({
            data: { status: 'uploading' },
            where: { id: current.id },
          });
        }
        response = mapAudioChunk(uploaded);
      }
      await this.writeIdempotency(transaction, input.requestId, binding, response);
      return response;
    });
  }

  public async completeObject(
    actor: AuthPrincipal,
    audioObjectId: string,
    input: CompleteAudioObjectRequest,
  ): Promise<AudioManifestResponse> {
    const object = await this.findObjectForWrite(actor, audioObjectId);
    const binding = this.binding('audio_object.complete', actor.id, 'audio_object', audioObjectId);
    const replay = await this.findReplay<AudioManifestResponse>(input.request_id, binding);
    if (replay !== null) return replay;
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `request:${input.request_id}`);
      const repeated = await this.findReplayInTransaction<AudioManifestResponse>(
        transaction,
        input.request_id,
        binding,
      );
      if (repeated !== null) return repeated;
      await this.lock(transaction, `project:${object.projectId}`);
      if (object.sessionId !== null) await this.lock(transaction, `session:${object.sessionId}`);
      await this.lock(transaction, `audio:${audioObjectId}`);
      const current = await transaction.audioObject.findUnique({ where: { id: audioObjectId } });
      if (current === null) throw this.notFound();
      await this.assertCompleteAuthority(transaction, current, actor, input.expected_chunk_count);
      await this.assertWritable(transaction, current);
      const chunks = await transaction.audioChunk.findMany({
        orderBy: { sequenceNo: 'asc' },
        where: { audioObjectId },
      });
      const finalization = await transaction.sessionFinalization.findUnique({
        include: { chunks: { orderBy: { sequenceNo: 'asc' } } },
        where: { audioObjectId },
      });
      try {
        this.integrity.assertContinuous(chunks, input.expected_chunk_count);
        if (
          finalization !== null &&
          (finalization.expectedChunkCount !== input.expected_chunk_count ||
            finalization.chunks.length !== chunks.length ||
            chunks.some((chunk, index) => {
              const commitment = finalization.chunks[index];
              return (
                commitment === undefined ||
                commitment.sequenceNo !== chunk.sequenceNo ||
                commitment.startMs !== chunk.startMs ||
                commitment.endMs !== chunk.endMs ||
                commitment.sizeBytes !== chunk.sizeBytes ||
                commitment.checksum !== chunk.checksum ||
                commitment.mimeType !== chunk.mimeType
              );
            }))
        ) {
          throw new Error('Frozen commitment mismatch');
        }
        for (const chunk of chunks) {
          if (chunk.uploadStatus !== 'uploaded' || chunk.uploadedAt === null) {
            throw new Error('Chunk is not uploaded');
          }
          const stored = await this.storage.inspect(chunk.objectKey);
          if (stored.checksum !== chunk.checksum || stored.sizeBytes !== chunk.sizeBytes) {
            throw new Error('Stored chunk mismatch');
          }
        }
      } catch {
        throw new ConflictException({
          code: 'AUDIO_MANIFEST_INCOMPLETE',
          details: {},
          message: 'Audio manifest is incomplete or inconsistent',
        });
      }
      const manifestChecksum = canonicalAudioManifestChecksum(chunks);
      const totalSizeBytes = chunks.reduce((sum, chunk) => sum + BigInt(chunk.sizeBytes), 0n);
      const completed = await transaction.audioObject.update({
        data: {
          chunkCount: input.expected_chunk_count,
          completedAt: new Date(),
          manifestChecksum,
          status: 'complete',
          totalSizeBytes,
        },
        where: { id: current.id },
      });
      const response = mapAudioManifest(completed, chunks);
      await this.writeIdempotency(transaction, input.request_id, binding, response);
      return response;
    });
  }

  public async getManifest(
    actor: AuthPrincipal,
    audioObjectId: string,
  ): Promise<AudioManifestResponse> {
    const object = await this.findAccessibleObject(actor, audioObjectId);
    const chunks = await this.prisma.audioChunk.findMany({
      orderBy: { sequenceNo: 'asc' },
      where: { audioObjectId },
    });
    return mapAudioManifest(object, chunks);
  }

  private async assertProjectAccess(actor: AuthPrincipal, projectId: string): Promise<void> {
    await this.authorization.assertRole(actor, ['interviewer']);
    const project = await this.prisma.elderProject.findUnique({
      select: {
        deletedAt: true,
        status: true,
        assignments: { select: { id: true }, where: { revokedAt: null, userId: actor.id } },
      },
      where: { id: projectId },
    });
    if (project === null || project.deletedAt !== null || project.status === 'deleted') {
      throw this.notFound();
    }
    if (project.assignments.length === 0) throw this.forbidden();
  }

  private async findAccessibleObject(
    actor: AuthPrincipal,
    audioObjectId: string,
  ): Promise<AudioObject> {
    const object = await this.prisma.audioObject.findUnique({ where: { id: audioObjectId } });
    if (object === null) throw this.notFound();
    await this.assertProjectAccess(actor, object.projectId);
    return object;
  }

  private async findObjectForWrite(
    actor: AuthPrincipal,
    audioObjectId: string,
  ): Promise<AudioObject> {
    await this.authorization.assertRole(actor, ['interviewer']);
    const object = await this.prisma.audioObject.findUnique({ where: { id: audioObjectId } });
    if (object === null) throw this.notFound();
    return object;
  }

  private async assertUploadAuthority(
    transaction: Prisma.TransactionClient,
    object: AudioObject,
    actor: AuthPrincipal,
    input: AudioChunkInput,
  ): Promise<void> {
    const finalization = await transaction.sessionFinalization.findUnique({
      where: { audioObjectId: object.id },
    });
    if (finalization !== null) {
      if (actor.status !== 'active' || finalization.createdBy !== actor.id) throw this.forbidden();
      const commitment = await transaction.sessionFinalizationChunk.findUnique({
        where: {
          sessionFinalizationId_sequenceNo: {
            sessionFinalizationId: finalization.id,
            sequenceNo: input.sequenceNo,
          },
        },
      });
      if (
        commitment === null ||
        commitment.checksum !== input.checksum ||
        commitment.startMs !== input.startMs ||
        commitment.endMs !== input.endMs ||
        commitment.mimeType !== input.mimeType
      )
        throw new ConflictException({
          code: 'AUDIO_COMMITMENT_CONFLICT',
          details: {},
          message: 'Audio chunk is outside the frozen commitment',
        });
      await transaction.auditLog.create({
        data: {
          action: 'audio.evidence_upload',
          actorId: actor.id,
          actorType: 'user',
          entityId: object.id,
          entityType: 'audio_object',
          metadata: { sequence_no: input.sequenceNo },
          requestId: input.requestId,
        },
      });
      return;
    }
    const assignment = await transaction.projectAssignment.findFirst({
      where: { projectId: object.projectId, revokedAt: null, userId: actor.id },
    });
    if (assignment !== null) return;
    throw this.forbidden();
  }

  private async assertCompleteAuthority(
    transaction: Prisma.TransactionClient,
    object: AudioObject,
    actor: AuthPrincipal,
    expectedCount: number,
  ): Promise<void> {
    const finalization = await transaction.sessionFinalization.findUnique({
      where: { audioObjectId: object.id },
    });
    if (finalization !== null) {
      if (
        actor.status !== 'active' ||
        finalization.createdBy !== actor.id ||
        finalization.expectedChunkCount !== expectedCount
      )
        throw new ConflictException({
          code: 'AUDIO_COMMITMENT_CONFLICT',
          details: {},
          message: 'Audio count is outside the frozen commitment',
        });
      return;
    }
    const assignment = await transaction.projectAssignment.findFirst({
      where: { projectId: object.projectId, revokedAt: null, userId: actor.id },
    });
    if (assignment !== null) return;
    throw this.forbidden();
  }

  private async assertCreateGate(
    transaction: Prisma.TransactionClient,
    projectId: string,
    input: CreateAudioObjectRequest,
  ): Promise<void> {
    const project = await transaction.elderProject.findUnique({ where: { id: projectId } });
    if (project === null || project.deletedAt !== null || project.status === 'deleted') {
      throw this.notFound();
    }
    if (input.purpose === 'consent') return;
    throw new ConflictException({
      code: 'INTERVIEW_AUDIO_START_REQUIRED',
      details: {},
      message: 'Interview audio objects are created by atomic session start',
    });
  }

  private async assertWritable(
    transaction: Prisma.TransactionClient,
    object: AudioObject,
  ): Promise<void> {
    if (object.status === 'complete') {
      throw new ConflictException({
        code: 'AUDIO_OBJECT_COMPLETE',
        details: {},
        message: 'Audio object is already complete',
      });
    }
    if (object.status === 'failed') throw this.invalidAudioState();
    if (object.purpose === 'consent') return;
    const session = await transaction.interviewSession.findUnique({
      where: { id: object.sessionId ?? '' },
    });
    if (
      session === null ||
      session.projectId !== object.projectId ||
      !['recording', 'reconnecting', 'stopping'].includes(session.status)
    ) {
      throw this.invalidAudioState();
    }
  }

  private async assertActiveAssignment(
    transaction: Prisma.TransactionClient,
    projectId: string,
    actorId: string,
  ): Promise<void> {
    const assignment = await transaction.projectAssignment.findFirst({
      where: { projectId, revokedAt: null, userId: actorId },
    });
    if (assignment === null) throw this.forbidden();
  }

  private binding(
    action: string,
    actorId: string,
    targetType: string,
    targetId: string,
  ): IdempotencyBinding {
    return { action, actorId, targetId, targetType };
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
    response: AudioObjectResponse | AudioChunkResponse | AudioManifestResponse,
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

  private forbidden(): ForbiddenException {
    return new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'Access denied' });
  }

  private invalidAudioState(): ConflictException {
    return new ConflictException({
      code: 'INVALID_AUDIO_STATE',
      details: {},
      message: 'Audio object is not writable in the current state',
    });
  }

  private chunkConflict(): ConflictException {
    return new ConflictException({
      code: 'AUDIO_CHUNK_CONFLICT',
      details: {},
      message: 'Audio chunk conflicts with immutable stored data',
    });
  }

  private storageUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'AUDIO_STORAGE_UNAVAILABLE',
      details: {},
      message: 'Audio storage is unavailable',
    });
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
