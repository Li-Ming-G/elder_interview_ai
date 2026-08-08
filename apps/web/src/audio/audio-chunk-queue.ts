import {
  AudioBufferCapacityError,
  AudioBufferConflictError,
  AudioBufferWriteError,
} from './errors.js';
import {
  audioChunkKey,
  type AudioArchiveSnapshot,
  type AudioChunkStore,
  type BufferedAudioChunk,
  type ImmutableAudioChunk,
  type NewAudioChunk,
} from './types.js';

export type BlobChecksum = (blob: Blob) => Promise<string>;

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AudioChunkQueueOptions {
  checksum?: BlobChecksum;
  maximumBufferedBytes: number;
  now?: () => Date;
}

export class AudioChunkQueue {
  private readonly checksum: BlobChecksum;
  private readonly now: () => Date;

  public constructor(
    private readonly store: AudioChunkStore,
    private readonly options: AudioChunkQueueOptions,
  ) {
    if (!Number.isSafeInteger(options.maximumBufferedBytes) || options.maximumBufferedBytes <= 0) {
      throw new RangeError('maximumBufferedBytes must be a positive safe integer');
    }
    this.checksum = options.checksum ?? sha256Blob;
    this.now = options.now ?? ((): Date => new Date());
  }

  public async enqueue(input: NewAudioChunk): Promise<BufferedAudioChunk> {
    validateNewChunk(input);
    const checksumSha256 = await this.checksum(input.blob);
    const record: BufferedAudioChunk = {
      chunk: {
        blob: input.blob,
        byteLength: input.blob.size,
        checksumSha256,
        createdAt: this.now().toISOString(),
        endedAtMs: input.endedAtMs,
        key: audioChunkKey(input.sessionId, input.sequenceNo),
        mimeType: input.mimeType,
        sequenceNo: input.sequenceNo,
        sessionId: input.sessionId,
        startedAtMs: input.startedAtMs,
      },
      delivery: { lastError: null, retryCount: 0, status: 'pending' },
    };

    try {
      return await this.store.persistImmutable(record, this.options.maximumBufferedBytes);
    } catch (error) {
      if (error instanceof AudioBufferCapacityError || error instanceof AudioBufferConflictError) {
        throw error;
      }
      throw new AudioBufferWriteError(error);
    }
  }

  public async restore(sessionId: string): Promise<BufferedAudioChunk[]> {
    requireSessionId(sessionId);
    return this.store.list(sessionId);
  }

  public async restoreArchive(sessionId: string): Promise<ImmutableAudioChunk[]> {
    requireSessionId(sessionId);
    return this.store.listArchive(sessionId);
  }

  public async getArchiveSnapshot(sessionId: string): Promise<AudioArchiveSnapshot> {
    requireSessionId(sessionId);
    return this.store.getArchiveSnapshot(sessionId);
  }

  public async runCanary(): Promise<void> {
    return this.store.runCanary();
  }

  public async getNextSequenceNo(sessionId: string): Promise<number> {
    requireSessionId(sessionId);
    return this.store.getNextSequenceNo(sessionId);
  }

  public async getTimelineEndMs(sessionId: string): Promise<number> {
    requireSessionId(sessionId);
    return this.store.getTimelineEndMs(sessionId);
  }

  public async markUploading(sessionId: string, sequenceNo: number): Promise<void> {
    await this.store.markUploading(sessionId, sequenceNo);
  }

  public async markFailed(sessionId: string, sequenceNo: number, errorCode: string): Promise<void> {
    await this.store.markFailed(sessionId, sequenceNo, errorCode);
  }

  public async acknowledge(
    sessionId: string,
    sequenceNo: number,
    checksumSha256: string,
  ): Promise<boolean> {
    requireSessionId(sessionId);
    if (checksumSha256.length === 0) throw new TypeError('checksumSha256 is required');
    return this.store.acknowledge(sessionId, sequenceNo, checksumSha256);
  }
}

function validateNewChunk(input: NewAudioChunk): void {
  requireSessionId(input.sessionId);
  if (!Number.isSafeInteger(input.sequenceNo) || input.sequenceNo < 0) {
    throw new RangeError('sequenceNo must be a non-negative safe integer');
  }
  if (!Number.isFinite(input.startedAtMs) || input.startedAtMs < 0) {
    throw new RangeError('startedAtMs must be non-negative');
  }
  if (!Number.isFinite(input.endedAtMs) || input.endedAtMs < input.startedAtMs) {
    throw new RangeError('endedAtMs must be greater than or equal to startedAtMs');
  }
  if (input.blob.size === 0) throw new RangeError('empty audio chunks are not persisted');
  if (input.mimeType.trim().length === 0) throw new TypeError('mimeType is required');
}

function requireSessionId(sessionId: string): void {
  if (sessionId.trim().length === 0) throw new TypeError('sessionId is required');
}
