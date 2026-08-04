import { AudioBufferCapacityError, AudioBufferConflictError } from './errors.js';
import { audioChunkKey, type AudioChunkStore, type BufferedAudioChunk } from './types.js';

export class InMemoryAudioChunkStore implements AudioChunkStore {
  private readonly records = new Map<string, BufferedAudioChunk>();
  private readonly nextSequenceNumbers = new Map<string, number>();
  private readonly timelineEnds = new Map<string, number>();

  public acknowledge(
    sessionId: string,
    sequenceNo: number,
    checksumSha256: string,
  ): Promise<boolean> {
    const key = audioChunkKey(sessionId, sequenceNo);
    const existing = this.records.get(key);
    if (existing === undefined || existing.chunk.checksumSha256 !== checksumSha256) {
      return Promise.resolve(false);
    }
    this.records.delete(key);
    return Promise.resolve(true);
  }

  public get(sessionId: string, sequenceNo: number): Promise<BufferedAudioChunk | null> {
    return Promise.resolve(this.records.get(audioChunkKey(sessionId, sequenceNo)) ?? null);
  }

  public getNextSequenceNo(sessionId: string): Promise<number> {
    return Promise.resolve(this.nextSequenceNumbers.get(sessionId) ?? 0);
  }

  public getTimelineEndMs(sessionId: string): Promise<number> {
    return Promise.resolve(this.timelineEnds.get(sessionId) ?? 0);
  }

  public list(sessionId: string): Promise<BufferedAudioChunk[]> {
    return Promise.resolve(
      [...this.records.values()]
        .filter((record) => record.chunk.sessionId === sessionId)
        .sort((left, right) => left.chunk.sequenceNo - right.chunk.sequenceNo),
    );
  }

  public async markFailed(sessionId: string, sequenceNo: number, errorCode: string): Promise<void> {
    const existing = await this.required(sessionId, sequenceNo);
    this.records.set(existing.chunk.key, {
      chunk: existing.chunk,
      delivery: {
        lastError: errorCode,
        retryCount: existing.delivery.retryCount + 1,
        status: 'failed',
      },
    });
  }

  public async markUploading(sessionId: string, sequenceNo: number): Promise<void> {
    const existing = await this.required(sessionId, sequenceNo);
    this.records.set(existing.chunk.key, {
      chunk: existing.chunk,
      delivery: { ...existing.delivery, lastError: null, status: 'uploading' },
    });
  }

  public persistImmutable(
    record: BufferedAudioChunk,
    maximumBufferedBytes: number,
  ): Promise<BufferedAudioChunk> {
    const existing = this.records.get(record.chunk.key);
    if (existing !== undefined) {
      if (!sameImmutableChunk(existing, record)) throw new AudioBufferConflictError();
      return Promise.resolve(existing);
    }
    const bytes = [...this.records.values()].reduce(
      (total, item) => total + item.chunk.byteLength,
      0,
    );
    if (bytes + record.chunk.byteLength > maximumBufferedBytes) {
      throw new AudioBufferCapacityError();
    }
    this.records.set(record.chunk.key, record);
    this.nextSequenceNumbers.set(
      record.chunk.sessionId,
      Math.max(
        this.nextSequenceNumbers.get(record.chunk.sessionId) ?? 0,
        record.chunk.sequenceNo + 1,
      ),
    );
    this.timelineEnds.set(
      record.chunk.sessionId,
      Math.max(this.timelineEnds.get(record.chunk.sessionId) ?? 0, record.chunk.endedAtMs),
    );
    return Promise.resolve(record);
  }

  private async required(sessionId: string, sequenceNo: number): Promise<BufferedAudioChunk> {
    const record = await this.get(sessionId, sequenceNo);
    if (record === null) throw new Error('audio chunk not found');
    return record;
  }
}

export function sameImmutableChunk(left: BufferedAudioChunk, right: BufferedAudioChunk): boolean {
  return (
    left.chunk.key === right.chunk.key &&
    left.chunk.sessionId === right.chunk.sessionId &&
    left.chunk.sequenceNo === right.chunk.sequenceNo &&
    left.chunk.startedAtMs === right.chunk.startedAtMs &&
    left.chunk.endedAtMs === right.chunk.endedAtMs &&
    left.chunk.mimeType === right.chunk.mimeType &&
    left.chunk.byteLength === right.chunk.byteLength &&
    left.chunk.checksumSha256 === right.chunk.checksumSha256
  );
}
