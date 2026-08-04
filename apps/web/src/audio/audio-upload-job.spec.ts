import { describe, expect, it, vi } from 'vitest';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { AudioUploadJobRunner, InMemoryAudioUploadJobStore } from './audio-upload-job.js';
import { InMemoryAudioChunkStore } from './in-memory-audio-chunk-store.js';

const OBJECT_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function harness(fetch: typeof globalThis.fetch): {
  jobs: InMemoryAudioUploadJobStore;
  queue: AudioChunkQueue;
  runner: AudioUploadJobRunner;
} {
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
  ];
  const jobs = new InMemoryAudioUploadJobStore();
  const queue = new AudioChunkQueue(new InMemoryAudioChunkStore(), {
    checksum: async (blob): Promise<string> => `checksum-${await blob.text()}`,
    maximumBufferedBytes: 1024,
  });
  return {
    jobs,
    queue,
    runner: new AudioUploadJobRunner(queue, jobs, {
      fetch,
      requestId: () => ids.shift() ?? '00000000-0000-4000-8000-999999999999',
    }),
  };
}

async function enqueueTwo(queue: AudioChunkQueue): Promise<void> {
  await queue.enqueue({
    blob: new Blob(['zero'], { type: 'audio/webm' }),
    endedAtMs: 1000,
    mimeType: 'audio/webm',
    sequenceNo: 0,
    sessionId: 'buffer-session',
    startedAtMs: 0,
  });
  await queue.enqueue({
    blob: new Blob(['one'], { type: 'audio/webm' }),
    endedAtMs: 2000,
    mimeType: 'audio/webm',
    sequenceNo: 1,
    sessionId: 'buffer-session',
    startedAtMs: 1000,
  });
}

async function createFrozen(runner: AudioUploadJobRunner): Promise<void> {
  await runner.create({
    bufferSessionId: 'buffer-session',
    jobId: 'job-1',
    mimeType: 'audio/webm',
    projectId: PROJECT_ID,
    purpose: 'consent',
    serverSessionId: null,
  });
  await runner.freeze('job-1');
}

describe('AudioUploadJobRunner', () => {
  it('reuses persisted IDs after lost chunk and complete responses', async () => {
    const chunkRequestIds: string[] = [];
    const completeRequestIds: string[] = [];
    let chunkZeroAttempts = 0;
    let completeAttempts = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      await Promise.resolve();
      const url = requestUrl(input);
      if (url.endsWith('/audio-objects')) {
        return json(
          {
            created_at: '2026-08-04T00:00:00.000Z',
            created_by: '30000000-0000-4000-8000-000000000001',
            id: OBJECT_ID,
            mime_type: 'audio/webm',
            project_id: PROJECT_ID,
            purpose: 'consent',
            session_id: null,
            status: 'initiated',
          },
          201,
        );
      }
      if (url.includes('/chunks/')) {
        const headers = new Headers(init?.headers);
        const sequence = Number(url.split('/').at(-1));
        chunkRequestIds.push(headers.get('X-Request-Id') ?? '');
        if (sequence === 0 && chunkZeroAttempts++ === 0) throw new Error('NETWORK_LOST');
        const body = init?.body as Blob;
        return json({
          audio_object_id: OBJECT_ID,
          checksum: headers.get('X-Chunk-SHA256'),
          end_ms: Number(headers.get('X-Chunk-End-Ms')),
          id: `40000000-0000-4000-8000-00000000000${String(sequence)}`,
          mime_type: headers.get('Content-Type'),
          sequence_no: sequence,
          size_bytes: body.size,
          start_ms: Number(headers.get('X-Chunk-Start-Ms')),
          upload_status: 'uploaded',
          uploaded_at: '2026-08-04T00:00:01.000Z',
        });
      }
      if (url.endsWith('/complete')) {
        if (typeof init?.body !== 'string') throw new Error('complete body must be JSON');
        const payload = JSON.parse(init.body) as { request_id: string };
        completeRequestIds.push(payload.request_id);
        if (completeAttempts++ === 0) throw new Error('COMPLETE_RESPONSE_LOST');
        return json({
          chunk_count: 2,
          chunks: [],
          completed_at: '2026-08-04T00:00:02.000Z',
          created_at: '2026-08-04T00:00:00.000Z',
          created_by: '30000000-0000-4000-8000-000000000001',
          id: OBJECT_ID,
          manifest_checksum: 'manifest-checksum',
          mime_type: 'audio/webm',
          project_id: PROJECT_ID,
          purpose: 'consent',
          session_id: null,
          status: 'complete',
          total_size_bytes: 7,
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const { jobs, queue, runner } = harness(fetch);
    await enqueueTwo(queue);
    await createFrozen(runner);

    expect((await runner.resume('job-1', 'csrf')).status).toBe('failed');
    const persistedAfterLoss = await jobs.getUploadJob('job-1');
    expect(persistedAfterLoss?.audioObjectId).toBe(OBJECT_ID);
    expect(persistedAfterLoss?.chunkRequestIds['0']).toBeDefined();
    expect(await queue.restore('buffer-session')).toHaveLength(2);

    expect((await runner.resume('job-1', 'csrf')).status).toBe('failed');
    expect(await queue.restore('buffer-session')).toHaveLength(0);
    expect((await runner.resume('job-1', 'csrf')).status).toBe('complete');
    expect(chunkRequestIds[0]).toBe(chunkRequestIds[1]);
    expect(completeRequestIds[0]).toBe(completeRequestIds[1]);
  });

  it('retains the local Blob when any ACK field mismatches', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      await Promise.resolve();
      const url = requestUrl(input);
      if (url.endsWith('/audio-objects')) {
        return json(
          {
            created_at: '2026-08-04T00:00:00.000Z',
            created_by: '30000000-0000-4000-8000-000000000001',
            id: OBJECT_ID,
            mime_type: 'audio/webm',
            project_id: PROJECT_ID,
            purpose: 'consent',
            session_id: null,
            status: 'initiated',
          },
          201,
        );
      }
      return json({
        audio_object_id: OBJECT_ID,
        checksum: 'wrong',
        end_ms: 1000,
        id: '40000000-0000-4000-8000-000000000001',
        mime_type: 'audio/webm',
        sequence_no: 0,
        size_bytes: 4,
        start_ms: 0,
        upload_status: 'uploaded',
        uploaded_at: '2026-08-04T00:00:01.000Z',
      });
    });
    const { queue, runner } = harness(fetch);
    await queue.enqueue({
      blob: new Blob(['zero'], { type: 'audio/webm' }),
      endedAtMs: 1000,
      mimeType: 'audio/webm',
      sequenceNo: 0,
      sessionId: 'buffer-session',
      startedAtMs: 0,
    });
    await createFrozen(runner);

    const result = await runner.resume('job-1', 'csrf');
    expect(result).toMatchObject({ lastError: 'AUDIO_CHUNK_ACK_MISMATCH', status: 'failed' });
    expect(await queue.restore('buffer-session')).toHaveLength(1);
    expect((await queue.restore('buffer-session'))[0]?.delivery).toMatchObject({
      lastError: 'AUDIO_CHUNK_ACK_MISMATCH',
      status: 'failed',
    });
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
