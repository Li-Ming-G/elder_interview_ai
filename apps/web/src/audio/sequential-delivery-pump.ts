import type { AudioChunkQueue } from './audio-chunk-queue.js';
import type { AudioUploadJobStore, BufferedAudioChunk } from './types.js';

export interface AudioDeliveryAttempt {
  chunk: BufferedAudioChunk['chunk'];
  requestId: string;
}

export interface SequentialDeliveryPumpOptions {
  requestId?: () => string;
}

export type AudioChunkDeliverer = (attempt: AudioDeliveryAttempt) => Promise<boolean>;

export class SequentialAudioDeliveryPump {
  private readonly active = new Map<string, Promise<number>>();
  private readonly requestId: () => string;

  public constructor(
    private readonly queue: AudioChunkQueue,
    private readonly jobs: AudioUploadJobStore,
    options: SequentialDeliveryPumpOptions = {},
  ) {
    this.requestId = options.requestId ?? ((): string => globalThis.crypto.randomUUID());
  }

  public deliverPending(jobId: string, deliver: AudioChunkDeliverer): Promise<number> {
    const existing = this.active.get(jobId);
    if (existing !== undefined) return existing;
    const running = this.run(jobId, deliver).finally(() => {
      this.active.delete(jobId);
    });
    this.active.set(jobId, running);
    return running;
  }

  private async run(jobId: string, deliver: AudioChunkDeliverer): Promise<number> {
    let job = await this.jobs.getUploadJob(jobId);
    if (job === null) throw new Error('UPLOAD_JOB_NOT_FOUND');
    const pending = await this.queue.restore(job.bufferSessionId);
    let delivered = 0;
    for (const record of pending) {
      const key = String(record.chunk.sequenceNo);
      let requestId: string | undefined = job.chunkRequestIds[key];
      if (requestId === undefined) {
        const generatedRequestId = this.requestId();
        job = await this.jobs.updateUploadJob(jobId, (current) => ({
          ...current,
          chunkRequestIds: {
            ...current.chunkRequestIds,
            [key]: current.chunkRequestIds[key] ?? generatedRequestId,
          },
          lastError: null,
          status: 'uploading',
        }));
        requestId = job.chunkRequestIds[key];
        if (requestId === undefined) throw new Error('CHUNK_REQUEST_ID_MISSING');
      }
      await this.queue.markUploading(job.bufferSessionId, record.chunk.sequenceNo);
      try {
        if (!(await deliver({ chunk: record.chunk, requestId }))) {
          throw new Error('AUDIO_CHUNK_ACK_MISMATCH');
        }
        const acknowledged = await this.queue.acknowledge(
          job.bufferSessionId,
          record.chunk.sequenceNo,
          record.chunk.checksumSha256,
        );
        if (!acknowledged) throw new Error('LOCAL_ACK_FAILED');
        delivered += 1;
      } catch (error) {
        const code = error instanceof Error ? error.message : 'DELIVERY_FAILED';
        await this.queue.markFailed(job.bufferSessionId, record.chunk.sequenceNo, code);
        await this.jobs.updateUploadJob(jobId, (current) => ({
          ...current,
          lastError: code,
          status: 'failed',
        }));
        throw error;
      }
    }
    return delivered;
  }
}
