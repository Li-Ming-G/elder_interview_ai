import { AudioBufferCapacityError, AudioBufferConflictError } from './errors.js';
import {
  audioChunkKey,
  type AudioArchiveSnapshot,
  type AudioChunkDelivery,
  type AudioChunkStore,
  type BrowserCaptureCheckpoint,
  type BrowserCaptureCheckpointStore,
  type BufferedAudioChunk,
  type ImmutableAudioChunk,
} from './types.js';

export class InMemoryAudioChunkStore implements AudioChunkStore, BrowserCaptureCheckpointStore {
  private readonly archives = new Map<string, ImmutableAudioChunk>();
  private readonly checkpoints = new Map<string, BrowserCaptureCheckpoint>();
  private readonly deliveries = new Map<string, AudioChunkDelivery>();
  private readonly acknowledgedHighWater = new Map<string, number>();
  private readonly nextSequenceNumbers = new Map<string, number>();
  private readonly timelineEnds = new Map<string, number>();

  public acknowledge(
    sessionId: string,
    sequenceNo: number,
    checksumSha256: string,
  ): Promise<boolean> {
    const key = audioChunkKey(sessionId, sequenceNo);
    const archive = this.archives.get(key);
    if (
      archive === undefined ||
      archive.checksumSha256 !== checksumSha256 ||
      !this.deliveries.has(key)
    ) {
      return Promise.resolve(false);
    }
    this.deliveries.delete(key);
    this.acknowledgedHighWater.set(
      sessionId,
      Math.max(this.acknowledgedHighWater.get(sessionId) ?? -1, sequenceNo),
    );
    return Promise.resolve(true);
  }

  public get(sessionId: string, sequenceNo: number): Promise<BufferedAudioChunk | null> {
    const key = audioChunkKey(sessionId, sequenceNo);
    const chunk = this.archives.get(key);
    const delivery = this.deliveries.get(key);
    return Promise.resolve(
      chunk === undefined || delivery === undefined ? null : { chunk, delivery },
    );
  }

  public getArchive(sessionId: string, sequenceNo: number): Promise<ImmutableAudioChunk | null> {
    return Promise.resolve(this.archives.get(audioChunkKey(sessionId, sequenceNo)) ?? null);
  }

  public getArchiveSnapshot(sessionId: string): Promise<AudioArchiveSnapshot> {
    const archive = [...this.archives.values()].filter((chunk) => chunk.sessionId === sessionId);
    const pendingDeliveryCount = [...this.deliveries.keys()].filter((key) =>
      key.startsWith(`${sessionId}:`),
    ).length;
    return Promise.resolve({
      archiveByteLength: archive.reduce((total, chunk) => total + chunk.byteLength, 0),
      archiveChunkCount: archive.length,
      archiveHighWaterSequenceNo: (this.nextSequenceNumbers.get(sessionId) ?? 0) - 1,
      deliveryAcknowledgedHighWaterSequenceNo: this.acknowledgedHighWater.get(sessionId) ?? -1,
      pendingDeliveryCount,
      timelineEndMs: this.timelineEnds.get(sessionId) ?? 0,
    });
  }

  public getCaptureCheckpoint(localJobId: string): Promise<BrowserCaptureCheckpoint | null> {
    const checkpoint = this.checkpoints.get(localJobId);
    return Promise.resolve(checkpoint === undefined ? null : { ...checkpoint });
  }

  public getNextSequenceNo(sessionId: string): Promise<number> {
    return Promise.resolve(this.nextSequenceNumbers.get(sessionId) ?? 0);
  }

  public getTimelineEndMs(sessionId: string): Promise<number> {
    return Promise.resolve(this.timelineEnds.get(sessionId) ?? 0);
  }

  public list(sessionId: string): Promise<BufferedAudioChunk[]> {
    return Promise.resolve(
      [...this.archives.values()]
        .filter((chunk) => chunk.sessionId === sessionId)
        .flatMap((chunk) => {
          const delivery = this.deliveries.get(chunk.key);
          return delivery === undefined ? [] : [{ chunk, delivery }];
        })
        .sort((left, right) => left.chunk.sequenceNo - right.chunk.sequenceNo),
    );
  }

  public listArchive(sessionId: string): Promise<ImmutableAudioChunk[]> {
    return Promise.resolve(
      [...this.archives.values()]
        .filter((chunk) => chunk.sessionId === sessionId)
        .sort((left, right) => left.sequenceNo - right.sequenceNo),
    );
  }

  public async markFailed(sessionId: string, sequenceNo: number, errorCode: string): Promise<void> {
    const { chunk, delivery } = await this.required(sessionId, sequenceNo);
    this.deliveries.set(chunk.key, {
      lastError: errorCode,
      retryCount: delivery.retryCount + 1,
      status: 'failed',
    });
  }

  public async markUploading(sessionId: string, sequenceNo: number): Promise<void> {
    const { chunk, delivery } = await this.required(sessionId, sequenceNo);
    this.deliveries.set(chunk.key, { ...delivery, lastError: null, status: 'uploading' });
  }

  public persistImmutable(
    record: BufferedAudioChunk,
    maximumBufferedBytes: number,
  ): Promise<BufferedAudioChunk> {
    const existing = this.archives.get(record.chunk.key);
    if (existing !== undefined) {
      if (!sameImmutableChunk(existing, record.chunk)) throw new AudioBufferConflictError();
      return Promise.resolve({
        chunk: existing,
        delivery: this.deliveries.get(existing.key) ?? record.delivery,
      });
    }
    const bytes = [...this.archives.values()]
      .filter((chunk) => chunk.sessionId === record.chunk.sessionId)
      .reduce((total, chunk) => total + chunk.byteLength, 0);
    if (bytes + record.chunk.byteLength > maximumBufferedBytes) {
      throw new AudioBufferCapacityError();
    }
    this.archives.set(record.chunk.key, record.chunk);
    this.deliveries.set(record.chunk.key, record.delivery);
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

  public putCaptureCheckpoint(checkpoint: BrowserCaptureCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.localJobId, { ...checkpoint });
    return Promise.resolve();
  }

  public runCanary(): Promise<void> {
    return Promise.resolve();
  }

  private async required(sessionId: string, sequenceNo: number): Promise<BufferedAudioChunk> {
    const record = await this.get(sessionId, sequenceNo);
    if (record === null) throw new Error('audio delivery not found');
    return record;
  }
}

export function sameImmutableChunk(
  left: ImmutableAudioChunk | BufferedAudioChunk,
  right: ImmutableAudioChunk | BufferedAudioChunk,
): boolean {
  const leftChunk = 'chunk' in left ? left.chunk : left;
  const rightChunk = 'chunk' in right ? right.chunk : right;
  return (
    leftChunk.key === rightChunk.key &&
    leftChunk.sessionId === rightChunk.sessionId &&
    leftChunk.sequenceNo === rightChunk.sequenceNo &&
    leftChunk.startedAtMs === rightChunk.startedAtMs &&
    leftChunk.endedAtMs === rightChunk.endedAtMs &&
    leftChunk.mimeType === rightChunk.mimeType &&
    leftChunk.byteLength === rightChunk.byteLength &&
    leftChunk.checksumSha256 === rightChunk.checksumSha256
  );
}
