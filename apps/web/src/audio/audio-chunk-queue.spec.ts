// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { AudioBufferCapacityError, AudioBufferConflictError } from './errors.js';
import { InMemoryAudioChunkStore } from './in-memory-audio-chunk-store.js';
import type { NewAudioChunk } from './types.js';

const checksum = async (blob: Blob): Promise<string> => `checksum:${await blob.text()}`;

function createQueue(store: InMemoryAudioChunkStore, maximumBufferedBytes = 1024): AudioChunkQueue {
  return new AudioChunkQueue(store, {
    checksum,
    maximumBufferedBytes,
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  });
}

function chunk(blobText: string, sequenceNo = 0): NewAudioChunk {
  return {
    blob: new Blob([blobText], { type: 'audio/webm' }),
    endedAtMs: 1000,
    mimeType: 'audio/webm',
    sequenceNo,
    sessionId: 'fictional-session',
    startedAtMs: 0,
  };
}

describe('AudioChunkQueue', () => {
  it('persists immutable chunks and restores them after a queue instance is recreated', async () => {
    const store = new InMemoryAudioChunkStore();
    const firstPage = createQueue(store);
    await firstPage.enqueue(chunk('synthetic-audio'));

    const refreshedPage = createQueue(store);
    const restored = await refreshedPage.restore('fictional-session');

    expect(restored).toHaveLength(1);
    expect(restored[0]?.chunk).toMatchObject({
      byteLength: 15,
      checksumSha256: 'checksum:synthetic-audio',
      sequenceNo: 0,
      sessionId: 'fictional-session',
    });
    expect(restored[0]?.delivery.status).toBe('pending');
  });

  it('treats an identical duplicate as idempotent and rejects conflicting content', async () => {
    const store = new InMemoryAudioChunkStore();
    const queue = createQueue(store);
    const first = await queue.enqueue(chunk('same'));
    const duplicate = await queue.enqueue(chunk('same'));

    expect(duplicate.chunk.checksumSha256).toBe(first.chunk.checksumSha256);
    expect(await queue.restore('fictional-session')).toHaveLength(1);
    await expect(queue.enqueue(chunk('different'))).rejects.toBeInstanceOf(
      AudioBufferConflictError,
    );
  });

  it('never deletes before an ACK with the matching checksum', async () => {
    const store = new InMemoryAudioChunkStore();
    const queue = createQueue(store);
    const persisted = await queue.enqueue(chunk('pending'));

    expect(await queue.acknowledge('fictional-session', 0, 'wrong')).toBe(false);
    expect(await queue.restore('fictional-session')).toHaveLength(1);
    expect(await queue.acknowledge('fictional-session', 0, persisted.chunk.checksumSha256)).toBe(
      true,
    );
    expect(await queue.restore('fictional-session')).toHaveLength(0);
    expect(await queue.getNextSequenceNo('fictional-session')).toBe(1);
    expect(await queue.getTimelineEndMs('fictional-session')).toBe(1000);
  });

  it('keeps raw chunk fields unchanged while delivery retries change separately', async () => {
    const store = new InMemoryAudioChunkStore();
    const queue = createQueue(store);
    const persisted = await queue.enqueue(chunk('retry'));

    await queue.markUploading('fictional-session', 0);
    await queue.markFailed('fictional-session', 0, 'NETWORK_UNAVAILABLE');
    const [failed] = await queue.restore('fictional-session');

    expect(failed?.chunk).toEqual(persisted.chunk);
    expect(failed?.delivery).toEqual({
      lastError: 'NETWORK_UNAVAILABLE',
      retryCount: 1,
      status: 'failed',
    });
  });

  it('fails visibly instead of exceeding the configured reliable buffer limit', async () => {
    const queue = createQueue(new InMemoryAudioChunkStore(), 3);
    await expect(queue.enqueue(chunk('four'))).rejects.toBeInstanceOf(AudioBufferCapacityError);
    expect(await queue.restore('fictional-session')).toHaveLength(0);
  });
});
