// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { AudioUploadJobRunner } from './audio-upload-job.js';
import { InMemoryAudioChunkStore } from './in-memory-audio-chunk-store.js';
import { SequentialAudioDeliveryPump } from './sequential-delivery-pump.js';

describe('SequentialAudioDeliveryPump', () => {
  it('persists a stable request ID before delivery and keeps archive data after ACK', async () => {
    const chunks = new InMemoryAudioChunkStore();
    const jobs = new Map<string, Awaited<ReturnType<AudioUploadJobRunner['create']>>>();
    const jobStore = {
      getUploadJob: (
        jobId: string,
      ): Promise<Awaited<ReturnType<AudioUploadJobRunner['create']>> | null> =>
        Promise.resolve(jobs.get(jobId) ?? null),
      putUploadJob: (job: Awaited<ReturnType<AudioUploadJobRunner['create']>>): Promise<void> => {
        jobs.set(job.jobId, structuredClone(job));
        return Promise.resolve();
      },
    };
    const queue = new AudioChunkQueue(chunks, {
      checksum: async (blob): Promise<string> => `checksum:${await blob.text()}`,
      maximumBufferedBytes: 1024,
    });
    const runner = new AudioUploadJobRunner(queue, jobStore);
    await runner.create({
      bufferSessionId: 'pump-session',
      jobId: 'pump-job',
      mimeType: 'audio/webm',
      projectId: 'fictional-project',
      purpose: 'interview',
      serverSessionId: 'fictional-session',
    });
    await queue.enqueue({
      blob: new Blob(['pcm-archive'], { type: 'audio/webm' }),
      endedAtMs: 1000,
      mimeType: 'audio/webm',
      sequenceNo: 0,
      sessionId: 'pump-session',
      startedAtMs: 0,
    });
    const requestId = vi.fn(() => 'stable-request-id');
    const pump = new SequentialAudioDeliveryPump(queue, jobStore, { requestId });
    const attempts: string[] = [];

    await expect(
      pump.deliverPending('pump-job', ({ requestId: attempted }) => {
        attempts.push(attempted);
        return Promise.reject(new Error('response-lost'));
      }),
    ).rejects.toThrow('response-lost');
    await pump.deliverPending('pump-job', ({ requestId: attempted }) => {
      attempts.push(attempted);
      return Promise.resolve(true);
    });

    expect(attempts).toEqual(['stable-request-id', 'stable-request-id']);
    expect(requestId).toHaveBeenCalledOnce();
    expect(await queue.restore('pump-session')).toEqual([]);
    const [archived] = await queue.restoreArchive('pump-session');
    expect(await archived?.blob.text()).toBe('pcm-archive');
  });
});
