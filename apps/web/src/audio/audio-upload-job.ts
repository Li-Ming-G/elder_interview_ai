import type {
  AudioChunkResponse,
  AudioManifestResponse,
  AudioObjectResponse,
} from '@elder-interview/contracts';

import type { AudioChunkQueue } from './audio-chunk-queue.js';
import type { AudioUploadJob, AudioUploadJobStore, BufferedAudioChunk } from './types.js';

export interface CreateAudioUploadJobInput {
  bufferSessionId: string;
  jobId: string;
  mimeType: string;
  projectId: string;
  purpose: 'consent' | 'interview';
  serverSessionId: string | null;
}

export interface AudioUploadJobRunnerOptions {
  fetch?: typeof globalThis.fetch;
  requestId?: () => string;
}

export class AudioUploadJobRunner {
  private readonly fetch: typeof globalThis.fetch;
  private readonly requestId: () => string;

  public constructor(
    private readonly queue: AudioChunkQueue,
    private readonly jobs: AudioUploadJobStore,
    options: AudioUploadJobRunnerOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestId = options.requestId ?? ((): string => globalThis.crypto.randomUUID());
  }

  public async create(input: CreateAudioUploadJobInput): Promise<AudioUploadJob> {
    validateCreate(input);
    const existing = await this.jobs.getUploadJob(input.jobId);
    if (existing !== null) {
      if (!sameJobIdentity(existing, input)) throw new Error('UPLOAD_JOB_CONFLICT');
      return existing;
    }
    const job: AudioUploadJob = {
      audioObjectId: null,
      bufferSessionId: input.bufferSessionId,
      chunkRequestIds: {},
      completeRequestId: null,
      createRequestId: this.requestId(),
      expectedChunkCount: null,
      jobId: input.jobId,
      lastError: null,
      mimeType: input.mimeType,
      projectId: input.projectId,
      purpose: input.purpose,
      serverSessionId: input.serverSessionId,
      status: 'recording',
    };
    await this.jobs.putUploadJob(job);
    return job;
  }

  public async freeze(jobId: string): Promise<AudioUploadJob> {
    const job = await this.requiredJob(jobId);
    if (job.expectedChunkCount !== null) return job;
    const expectedChunkCount = await this.queue.getNextSequenceNo(job.bufferSessionId);
    if (expectedChunkCount < 1) throw new Error('UPLOAD_JOB_EMPTY');
    const frozen: AudioUploadJob = {
      ...job,
      completeRequestId: job.completeRequestId ?? this.requestId(),
      expectedChunkCount,
      lastError: null,
      status: 'uploading',
    };
    await this.jobs.putUploadJob(frozen);
    return frozen;
  }

  public async resume(jobId: string, csrfToken: string): Promise<AudioUploadJob> {
    let job = await this.requiredJob(jobId);
    if (job.status === 'complete') return job;
    if (job.expectedChunkCount === null || job.completeRequestId === null) {
      throw new Error('UPLOAD_JOB_NOT_FROZEN');
    }
    try {
      job = await this.ensureAudioObject(job, csrfToken);
      const chunks = await this.queue.restore(job.bufferSessionId);
      for (const record of chunks) job = await this.uploadChunk(job, record, csrfToken);
      const remaining = await this.queue.restore(job.bufferSessionId);
      if (remaining.length !== 0) throw new Error('UPLOAD_JOB_CHUNKS_REMAIN');
      if (job.audioObjectId === null) throw new Error('AUDIO_OBJECT_MISSING');
      const audioObjectId = job.audioObjectId;
      job = { ...job, lastError: null, status: 'completing' };
      await this.jobs.putUploadJob(job);
      const response = await this.fetch(`/api/v1/audio-objects/${audioObjectId}/complete`, {
        body: JSON.stringify({
          expected_chunk_count: job.expectedChunkCount,
          request_id: job.completeRequestId,
        }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        method: 'POST',
      });
      const manifest = await readJson<AudioManifestResponse>(response);
      assertCompleteAck(job, manifest);
      job = { ...job, lastError: null, status: 'complete' };
      await this.jobs.putUploadJob(job);
      return job;
    } catch (error) {
      const latest = (await this.jobs.getUploadJob(jobId)) ?? job;
      const failed = { ...latest, lastError: errorCode(error), status: 'failed' as const };
      await this.jobs.putUploadJob(failed);
      return failed;
    }
  }

  private async ensureAudioObject(job: AudioUploadJob, csrfToken: string): Promise<AudioUploadJob> {
    if (job.audioObjectId !== null) return job;
    const response = await this.fetch(`/api/v1/projects/${job.projectId}/audio-objects`, {
      body: JSON.stringify({
        mime_type: job.mimeType,
        purpose: job.purpose,
        request_id: job.createRequestId,
        session_id: job.serverSessionId,
      }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      method: 'POST',
    });
    const created = await readJson<AudioObjectResponse>(response);
    if (
      created.project_id !== job.projectId ||
      created.purpose !== job.purpose ||
      created.session_id !== job.serverSessionId ||
      created.mime_type !== job.mimeType ||
      (created.status !== 'initiated' && created.status !== 'uploading')
    ) {
      throw new Error('AUDIO_OBJECT_ACK_MISMATCH');
    }
    const updated = {
      ...job,
      audioObjectId: created.id,
      lastError: null,
      status: 'uploading' as const,
    };
    await this.jobs.putUploadJob(updated);
    return updated;
  }

  private async uploadChunk(
    job: AudioUploadJob,
    record: BufferedAudioChunk,
    csrfToken: string,
  ): Promise<AudioUploadJob> {
    if (job.audioObjectId === null) throw new Error('AUDIO_OBJECT_MISSING');
    const audioObjectId = job.audioObjectId;
    const sequenceKey = String(record.chunk.sequenceNo);
    let requestId = job.chunkRequestIds[sequenceKey];
    if (requestId === undefined) {
      requestId = this.requestId();
      job = {
        ...job,
        chunkRequestIds: { ...job.chunkRequestIds, [sequenceKey]: requestId },
        lastError: null,
        status: 'uploading',
      };
      await this.jobs.putUploadJob(job);
    }
    await this.queue.markUploading(job.bufferSessionId, record.chunk.sequenceNo);
    try {
      const response = await this.fetch(
        `/api/v1/audio-objects/${audioObjectId}/chunks/${String(record.chunk.sequenceNo)}`,
        {
          body: record.chunk.blob,
          credentials: 'same-origin',
          headers: {
            'Content-Type': record.chunk.mimeType,
            'X-Chunk-End-Ms': String(record.chunk.endedAtMs),
            'X-Chunk-SHA256': record.chunk.checksumSha256,
            'X-Chunk-Start-Ms': String(record.chunk.startedAtMs),
            'X-CSRF-Token': csrfToken,
            'X-Request-Id': requestId,
          },
          method: 'PUT',
        },
      );
      const ack = await readJson<AudioChunkResponse>(response);
      assertChunkAck(audioObjectId, record, ack);
      const removed = await this.queue.acknowledge(
        job.bufferSessionId,
        record.chunk.sequenceNo,
        record.chunk.checksumSha256,
      );
      if (!removed) throw new Error('LOCAL_ACK_FAILED');
      return job;
    } catch (error) {
      await this.queue.markFailed(job.bufferSessionId, record.chunk.sequenceNo, errorCode(error));
      throw error;
    }
  }

  private async requiredJob(jobId: string): Promise<AudioUploadJob> {
    const job = await this.jobs.getUploadJob(jobId);
    if (job === null) throw new Error('UPLOAD_JOB_NOT_FOUND');
    return job;
  }
}

export class InMemoryAudioUploadJobStore implements AudioUploadJobStore {
  private readonly jobs = new Map<string, AudioUploadJob>();

  public getUploadJob(jobId: string): Promise<AudioUploadJob | null> {
    return Promise.resolve(cloneJob(this.jobs.get(jobId) ?? null));
  }

  public putUploadJob(job: AudioUploadJob): Promise<void> {
    this.jobs.set(job.jobId, cloneJob(job) as AudioUploadJob);
    return Promise.resolve();
  }
}

function assertChunkAck(
  audioObjectId: string,
  record: BufferedAudioChunk,
  ack: AudioChunkResponse,
): void {
  if (
    ack.audio_object_id !== audioObjectId ||
    ack.sequence_no !== record.chunk.sequenceNo ||
    ack.start_ms !== record.chunk.startedAtMs ||
    ack.end_ms !== record.chunk.endedAtMs ||
    ack.size_bytes !== record.chunk.byteLength ||
    ack.checksum !== record.chunk.checksumSha256 ||
    ack.mime_type !== record.chunk.mimeType ||
    (ack as { upload_status: unknown }).upload_status !== 'uploaded'
  ) {
    throw new Error('AUDIO_CHUNK_ACK_MISMATCH');
  }
}

function assertCompleteAck(job: AudioUploadJob, value: AudioManifestResponse): void {
  if (
    value.id !== job.audioObjectId ||
    value.status !== 'complete' ||
    value.chunk_count !== job.expectedChunkCount ||
    value.manifest_checksum === null ||
    value.manifest_checksum.length === 0
  ) {
    throw new Error('AUDIO_COMPLETE_ACK_MISMATCH');
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP_${String(response.status)}`);
  return (await response.json()) as T;
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : 'UPLOAD_FAILED';
}

function sameJobIdentity(job: AudioUploadJob, input: CreateAudioUploadJobInput): boolean {
  return (
    job.bufferSessionId === input.bufferSessionId &&
    job.projectId === input.projectId &&
    job.purpose === input.purpose &&
    job.serverSessionId === input.serverSessionId &&
    job.mimeType === input.mimeType
  );
}

function validateCreate(input: CreateAudioUploadJobInput): void {
  for (const value of [input.jobId, input.bufferSessionId, input.projectId, input.mimeType]) {
    if (value.trim().length === 0) throw new TypeError('upload job identity is required');
  }
  if (input.purpose === 'consent' && input.serverSessionId !== null) {
    throw new TypeError('consent upload job cannot bind a session');
  }
  if (input.purpose === 'interview' && input.serverSessionId === null) {
    throw new TypeError('interview upload job requires a session');
  }
}

function cloneJob(job: AudioUploadJob | null): AudioUploadJob | null {
  return job === null ? null : { ...job, chunkRequestIds: { ...job.chunkRequestIds } };
}
