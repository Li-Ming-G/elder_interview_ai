// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { IndexedDbAudioChunkStore } from './indexeddb-audio-chunk-store.js';
import type { AudioUploadJob, BufferedAudioChunk } from './types.js';

function queue(factory: IDBFactory): AudioChunkQueue {
  return new AudioChunkQueue(new IndexedDbAudioChunkStore(factory), {
    checksum: async (blob): Promise<string> => `checksum:${await blob.text()}`,
    maximumBufferedBytes: 1024,
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  });
}

describe('IndexedDbAudioChunkStore', () => {
  it('commits Blob data and preserves sequence high-water after ACK and reopening', async () => {
    const factory = new IDBFactory();
    const firstPage = queue(factory);
    const first = await firstPage.enqueue({
      blob: new Blob(['first'], { type: 'audio/webm' }),
      endedAtMs: 1000,
      mimeType: 'audio/webm',
      sequenceNo: 0,
      sessionId: 'fictional-indexeddb-session',
      startedAtMs: 0,
    });

    const [persisted] = await firstPage.restore('fictional-indexeddb-session');
    expect(persisted?.chunk).toMatchObject({
      byteLength: 5,
      checksumSha256: 'checksum:first',
      sequenceNo: 0,
    });
    expect(await firstPage.getNextSequenceNo('fictional-indexeddb-session')).toBe(1);
    expect(
      await firstPage.acknowledge('fictional-indexeddb-session', 0, first.chunk.checksumSha256),
    ).toBe(true);

    const reopenedPage = queue(factory);
    expect(await reopenedPage.restore('fictional-indexeddb-session')).toEqual([]);
    const [archived] = await reopenedPage.restoreArchive('fictional-indexeddb-session');
    expect(archived).toMatchObject({ byteLength: 5, checksumSha256: 'checksum:first' });
    expect(archived?.blob).toBeDefined();
    expect(await reopenedPage.getArchiveSnapshot('fictional-indexeddb-session')).toMatchObject({
      archiveChunkCount: 1,
      archiveHighWaterSequenceNo: 0,
      deliveryAcknowledgedHighWaterSequenceNo: 0,
      pendingDeliveryCount: 0,
      timelineEndMs: 1000,
    });
    expect(await reopenedPage.getNextSequenceNo('fictional-indexeddb-session')).toBe(1);
    expect(await reopenedPage.getTimelineEndMs('fictional-indexeddb-session')).toBe(1000);
    await reopenedPage.enqueue({
      blob: new Blob(['second'], { type: 'audio/webm' }),
      endedAtMs: 2000,
      mimeType: 'audio/webm',
      sequenceNo: 1,
      sessionId: 'fictional-indexeddb-session',
      startedAtMs: 1000,
    });
    expect(
      (await reopenedPage.restore('fictional-indexeddb-session')).map(
        (record) => record.chunk.sequenceNo,
      ),
    ).toEqual([1]);
  });

  it('persists upload jobs across store instances without changing chunk progress', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbAudioChunkStore(factory);
    await first.putUploadJob({
      audioObjectId: null,
      bufferSessionId: 'fictional-job-session',
      chunkRequestIds: { '0': '00000000-0000-4000-8000-000000000002' },
      completeRequestId: '00000000-0000-4000-8000-000000000003',
      createRequestId: '00000000-0000-4000-8000-000000000001',
      expectedChunkCount: 1,
      jobId: 'fictional-job',
      lastError: null,
      mimeType: 'audio/webm',
      projectId: 'fictional-project',
      purpose: 'consent',
      serverSessionId: null,
      status: 'uploading',
    });

    const reopened = new IndexedDbAudioChunkStore(factory);
    expect(await reopened.getUploadJob('fictional-job')).toMatchObject({
      chunkRequestIds: { '0': '00000000-0000-4000-8000-000000000002' },
      expectedChunkCount: 1,
      status: 'uploading',
    });
  });

  it('upgrades the version 2 database without losing chunks or session high-water marks', async () => {
    const factory = new IDBFactory();
    const legacyChunk: BufferedAudioChunk = {
      chunk: {
        blob: new Blob(['legacy'], { type: 'audio/webm' }),
        byteLength: 6,
        checksumSha256: 'checksum:legacy',
        createdAt: '2026-08-03T00:00:00.000Z',
        endedAtMs: 1500,
        key: 'legacy-session:0',
        mimeType: 'audio/webm',
        sequenceNo: 0,
        sessionId: 'legacy-session',
        startedAtMs: 0,
      },
      delivery: { lastError: null, retryCount: 0, status: 'pending' },
    };
    await createVersionTwoDatabase(factory, legacyChunk);

    const upgraded = new IndexedDbAudioChunkStore(factory);
    const [restored] = await upgraded.list('legacy-session');
    expect(restored).toMatchObject({
      chunk: {
        byteLength: 6,
        checksumSha256: 'checksum:legacy',
        sequenceNo: 0,
        sessionId: 'legacy-session',
      },
      delivery: { status: 'pending' },
    });
    expect(await upgraded.getNextSequenceNo('legacy-session')).toBe(1);
    expect(await upgraded.getTimelineEndMs('legacy-session')).toBe(1500);
    const [archived] = await upgraded.listArchive('legacy-session');
    expect(archived).toMatchObject({ byteLength: 6, checksumSha256: 'checksum:legacy' });
    expect(archived?.blob).toBeDefined();
    await upgraded.putUploadJob({
      audioObjectId: null,
      bufferSessionId: 'legacy-session',
      chunkRequestIds: {},
      completeRequestId: null,
      createRequestId: '00000000-0000-4000-8000-000000000001',
      expectedChunkCount: null,
      jobId: 'post-upgrade-job',
      lastError: null,
      mimeType: 'audio/webm',
      projectId: 'fictional-project',
      purpose: 'consent',
      serverSessionId: null,
      status: 'recording',
    });
    expect(await upgraded.getUploadJob('post-upgrade-job')).toMatchObject({
      bufferSessionId: 'legacy-session',
      status: 'recording',
    });
  });

  it('upgrades version 3 without losing its persisted upload job', async () => {
    const factory = new IDBFactory();
    const legacyJob: AudioUploadJob = {
      audioObjectId: 'fictional-object',
      bufferSessionId: 'v3-session',
      chunkRequestIds: { '0': 'stable-chunk-request' },
      completeRequestId: 'stable-complete-request',
      createRequestId: 'stable-create-request',
      expectedChunkCount: 1,
      jobId: 'v3-job',
      lastError: 'response-lost',
      mimeType: 'audio/webm',
      projectId: 'fictional-project',
      purpose: 'interview',
      serverSessionId: 'fictional-session',
      status: 'failed',
    };
    await createVersionThreeDatabase(factory, legacyJob);

    const upgraded = new IndexedDbAudioChunkStore(factory);
    expect(await upgraded.getUploadJob('v3-job')).toEqual(legacyJob);
  });
});

function createVersionTwoDatabase(
  factory: IDBFactory,
  legacyChunk: BufferedAudioChunk,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open('elder-interview-audio-buffer', 2);
    open.onupgradeneeded = (): void => {
      const chunks = open.result.createObjectStore('chunks', { keyPath: 'chunk.key' });
      chunks.createIndex('by-session', 'chunk.sessionId', { unique: false });
      open.result.createObjectStore('session-state', { keyPath: 'sessionId' });
      chunks.add(legacyChunk);
      open.transaction?.objectStore('session-state').add({
        nextSequenceNo: 1,
        sessionId: 'legacy-session',
        timelineEndMs: 1500,
      });
    };
    open.onerror = (): void => {
      reject(open.error ?? new Error('legacy database open failed'));
    };
    open.onsuccess = (): void => {
      open.result.close();
      resolve();
    };
  });
}

function createVersionThreeDatabase(factory: IDBFactory, job: AudioUploadJob): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open('elder-interview-audio-buffer', 3);
    open.onupgradeneeded = (): void => {
      const chunks = open.result.createObjectStore('chunks', { keyPath: 'chunk.key' });
      chunks.createIndex('by-session', 'chunk.sessionId', { unique: false });
      open.result.createObjectStore('session-state', { keyPath: 'sessionId' });
      open.result.createObjectStore('upload-jobs', { keyPath: 'jobId' }).add(job);
    };
    open.onerror = (): void => {
      reject(open.error ?? new Error('version 3 database open failed'));
    };
    open.onsuccess = (): void => {
      open.result.close();
      resolve();
    };
  });
}
