// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { IndexedDbAudioChunkStore } from './indexeddb-audio-chunk-store.js';
import type {
  AudioUploadJob,
  BufferedAudioChunk,
  CaptureInterruptionReportRecord,
} from './types.js';

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

  it('upgrades version 4 forward with session indexes and deletion receipts without data loss', async () => {
    const factory = new IDBFactory();
    await createVersionFourDatabase(factory);

    const upgraded = new IndexedDbAudioChunkStore(factory);
    await expect(upgraded.inspectLocalArchive('v4-session')).resolves.toMatchObject({
      archive: [{ byteLength: 5, sequenceNo: 0, sessionId: 'v4-session' }],
      pendingDeliveryCount: 0,
      receipt: null,
    });
    const database = await openDatabase(factory, 5);
    expect([...database.transaction('upload-jobs').objectStore('upload-jobs').indexNames]).toEqual(
      expect.arrayContaining(['by-buffer-session', 'by-report-session', 'by-server-session']),
    );
    expect([
      ...database.transaction('capture-checkpoints').objectStore('capture-checkpoints').indexNames,
    ]).toContain('by-session');
    expect([...database.objectStoreNames]).toContain('local-deletion-receipts');
    database.close();
  });

  it('cleans current, legacy, jobs, reports and checkpoints in one committed session transaction', async () => {
    const factory = new IDBFactory();
    const legacy = legacyRecord('target-session', 'legacy');
    await createVersionTwoDatabase(factory, legacy);
    const store = new IndexedDbAudioChunkStore(factory);
    await store.acknowledge('target-session', 0, 'checksum:legacy');
    await store.putUploadJob(completedInterviewJob('target-session'));
    await store.putUploadJob({
      ...completedInterviewJob('other-session'),
      jobId: 'other-consent-job',
      purpose: 'consent',
    });
    await store.putCaptureCheckpoint({
      archiveHighWaterSequenceNo: 0,
      audioStreamId: 'stream',
      deliveryAcknowledgedHighWaterSequenceNo: 0,
      dirty: false,
      localJobId: 'interview-capture:target-session',
      mimeType: 'audio/webm',
      sessionId: 'target-session',
      status: 'stopped',
      timelineEndMs: 1_000,
      updatedAt: '2026-08-12T00:00:00.000Z',
    });
    await store.getOrCreateCaptureInterruptionReport({
      ...interruptionReport('report-request'),
      audioStreamId: 'target-stream',
      jobId: 'capture-interruption-report:v1:target-session:2:target-stream',
      sessionId: 'target-session',
      status: 'acknowledged',
    });

    const before = await store.inspectLocalArchive('target-session');
    const commit = await store.deleteLocalArchive(
      'target-session',
      before.archive,
      '2026-08-12T08:00:00.000Z',
    );

    expect(commit).toMatchObject({
      receipt: { deleted_at: '2026-08-12T08:00:00.000Z' },
      result: 'deleted',
    });
    await expect(store.inspectLocalArchive('target-session')).resolves.toMatchObject({
      archive: [],
      pendingDeliveryCount: 0,
      receipt: { deleted_at: '2026-08-12T08:00:00.000Z' },
    });
    await expect(store.getUploadJob('interview-capture:target-session')).resolves.toBeNull();
    await expect(
      store.getCaptureCheckpoint('interview-capture:target-session'),
    ).resolves.toBeNull();
    await expect(store.getUploadJob('other-consent-job')).resolves.toMatchObject({
      purpose: 'consent',
    });
    expect(await countLegacySession(factory, 'target-session')).toBe(0);
  });

  it('rolls every target delete back when the receipt write aborts the transaction', async () => {
    const factory = new IDBFactory();
    await createBrokenVersionFiveDatabase(factory);
    const store = new IndexedDbAudioChunkStore(factory);
    const before = await store.inspectLocalArchive('rollback-session');

    await expect(
      store.deleteLocalArchive('rollback-session', before.archive, '2026-08-12T08:00:00.000Z'),
    ).rejects.toThrow();

    await expect(store.inspectLocalArchive('rollback-session')).resolves.toMatchObject({
      archive: [{ key: 'rollback-session:0' }],
      receipt: null,
    });
  });

  it('serializes upload-job field updates inside the existing version 4 store', async () => {
    const store = new IndexedDbAudioChunkStore(new IDBFactory());
    const job: AudioUploadJob = {
      audioObjectId: null,
      bufferSessionId: 'atomic-session',
      chunkRequestIds: {},
      completeRequestId: null,
      createRequestId: null,
      expectedChunkCount: null,
      jobId: 'atomic-job',
      lastError: null,
      mimeType: 'audio/webm',
      projectId: 'fictional-project',
      purpose: 'interview',
      serverSessionId: 'atomic-session',
      status: 'recording',
    };
    await store.putUploadJob(job);

    await Promise.all([
      store.updateUploadJob(job.jobId, (current) => ({
        ...current,
        chunkRequestIds: { ...current.chunkRequestIds, '0': 'stable-chunk-request' },
      })),
      store.updateUploadJob(job.jobId, (current) => ({
        ...current,
        completeRequestId: 'stable-complete-request',
      })),
    ]);

    await expect(store.getUploadJob(job.jobId)).resolves.toMatchObject({
      chunkRequestIds: { '0': 'stable-chunk-request' },
      completeRequestId: 'stable-complete-request',
    });
  });

  it('atomically creates one generation-scoped interruption report across store instances', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbAudioChunkStore(factory);
    const second = new IndexedDbAudioChunkStore(factory);
    const left = interruptionReport('request-left');
    const right = interruptionReport('request-right');

    const [firstResult, secondResult] = await Promise.all([
      first.getOrCreateCaptureInterruptionReport(left),
      second.getOrCreateCaptureInterruptionReport(right),
    ]);

    expect(firstResult.requestId).toBe(secondResult.requestId);
    expect(['request-left', 'request-right']).toContain(firstResult.requestId);
    await expect(first.getCaptureInterruptionReport(left.jobId)).resolves.toEqual(firstResult);
  });

  it('keeps upload jobs and interruption reports strictly discriminated in the same store', async () => {
    const store = new IndexedDbAudioChunkStore(new IDBFactory());
    const report = interruptionReport('stable-report-request');
    const job: AudioUploadJob = {
      audioObjectId: null,
      bufferSessionId: 'coexist-session',
      chunkRequestIds: {},
      completeRequestId: null,
      createRequestId: null,
      expectedChunkCount: null,
      jobId: 'coexist-upload-job',
      lastError: null,
      mimeType: 'audio/webm',
      projectId: 'fictional-project',
      purpose: 'interview',
      serverSessionId: 'coexist-session',
      status: 'recording',
    };
    await store.putUploadJob(job);
    await store.getOrCreateCaptureInterruptionReport(report);

    await expect(store.getUploadJob(job.jobId)).resolves.toEqual(job);
    await expect(store.getCaptureInterruptionReport(report.jobId)).resolves.toEqual(report);
    await expect(store.getUploadJob(report.jobId)).rejects.toThrow(
      'UPLOAD_JOB_RECORD_TYPE_MISMATCH',
    );
    await expect(store.getCaptureInterruptionReport(job.jobId)).rejects.toThrow(
      'CAPTURE_INTERRUPTION_REPORT_RECORD_INVALID',
    );
    await expect(
      store.getOrCreateCaptureInterruptionReport({ ...report, audioObjectId: 'different-object' }),
    ).rejects.toThrow('CAPTURE_INTERRUPTION_REPORT_IDENTITY_CONFLICT');
  });

  it('fails closed when a corrupted report record occupies the reserved key', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbAudioChunkStore(factory);
    const report = interruptionReport('stable-report-request');
    await store.getOrCreateCaptureInterruptionReport(report);
    await rawUploadJobPut(factory, { ...report, audioStreamId: null });

    await expect(store.getCaptureInterruptionReport(report.jobId)).rejects.toThrow(
      'CAPTURE_INTERRUPTION_REPORT_RECORD_INVALID',
    );
    await expect(store.getOrCreateCaptureInterruptionReport(report)).rejects.toThrow(
      'CAPTURE_INTERRUPTION_REPORT_RECORD_INVALID',
    );
  });
});

function interruptionReport(requestId: string): CaptureInterruptionReportRecord {
  return {
    audioObjectId: 'fictional-audio-object',
    audioStreamId: 'fictional-audio-stream',
    createdAt: '2026-08-08T00:00:00.000Z',
    generationNo: 2,
    jobId: 'capture-interruption-report:v1:fictional-session:2:fictional-audio-stream',
    lastError: null,
    projectId: 'fictional-project',
    reason: 'page_recovery_detected',
    recordType: 'capture-interruption-report-v1',
    requestId,
    sessionId: 'fictional-session',
    status: 'pending',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
}

function rawUploadJobPut(factory: IDBFactory, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open('elder-interview-audio-buffer', 5);
    open.onerror = (): void => {
      reject(open.error ?? new Error('database open failed'));
    };
    open.onsuccess = (): void => {
      const transaction = open.result.transaction('upload-jobs', 'readwrite');
      transaction.onerror = (): void => {
        reject(transaction.error ?? new Error('raw put failed'));
      };
      transaction.oncomplete = (): void => {
        open.result.close();
        resolve();
      };
      transaction.objectStore('upload-jobs').put(value);
    };
  });
}

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

function legacyRecord(sessionId: string, text: string): BufferedAudioChunk {
  return {
    chunk: {
      blob: new Blob([text], { type: 'audio/webm' }),
      byteLength: text.length,
      checksumSha256: `checksum:${text}`,
      createdAt: '2026-08-03T00:00:00.000Z',
      endedAtMs: 1_000,
      key: `${sessionId}:0`,
      mimeType: 'audio/webm',
      sequenceNo: 0,
      sessionId,
      startedAtMs: 0,
    },
    delivery: { lastError: null, retryCount: 0, status: 'pending' },
  };
}

function completedInterviewJob(sessionId: string): AudioUploadJob {
  return {
    audioObjectId: 'fictional-object',
    bufferSessionId: sessionId,
    chunkRequestIds: {},
    completeRequestId: 'complete-request',
    createRequestId: 'create-request',
    expectedChunkCount: 1,
    interviewCapture: {
      audioObjectId: 'fictional-object',
      audioStreamId: 'stream',
      confirmActiveRequests: {},
      generationNo: 1,
      interruptionReports: {},
      pendingResume: null,
      protocolVersion: 1,
      startRequestId: 'start-request',
      status: 'stopped',
      stopRequestId: 'stop-request',
      timelineOffsetMs: 0,
    },
    jobId: `interview-capture:${sessionId}`,
    lastError: null,
    mimeType: 'audio/webm',
    projectId: 'fictional-project',
    purpose: 'interview',
    serverSessionId: sessionId,
    status: 'complete',
  };
}

function createVersionFourDatabase(factory: IDBFactory): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open('elder-interview-audio-buffer', 4);
    open.onupgradeneeded = (): void => {
      const archive = open.result.createObjectStore('archive-chunks', { keyPath: 'key' });
      archive.createIndex('by-session', 'sessionId');
      const delivery = open.result.createObjectStore('delivery-queue', { keyPath: 'key' });
      delivery.createIndex('by-session', 'sessionId');
      open.result.createObjectStore('session-state', { keyPath: 'sessionId' });
      open.result.createObjectStore('upload-jobs', { keyPath: 'jobId' });
      open.result.createObjectStore('capture-checkpoints', { keyPath: 'localJobId' });
      open.result.createObjectStore('canary', { keyPath: 'key' });
      archive.add(legacyRecord('v4-session', 'hello').chunk);
    };
    open.onerror = (): void => {
      reject(open.error ?? new Error('version 4 database failed'));
    };
    open.onsuccess = (): void => {
      open.result.close();
      resolve();
    };
  });
}

function createBrokenVersionFiveDatabase(factory: IDBFactory): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open('elder-interview-audio-buffer', 5);
    open.onupgradeneeded = (): void => {
      const archive = open.result.createObjectStore('archive-chunks', { keyPath: 'key' });
      archive.createIndex('by-session', 'sessionId');
      const delivery = open.result.createObjectStore('delivery-queue', { keyPath: 'key' });
      delivery.createIndex('by-session', 'sessionId');
      open.result.createObjectStore('session-state', { keyPath: 'sessionId' });
      open.result.createObjectStore('upload-jobs', { keyPath: 'jobId' });
      open.result.createObjectStore('capture-checkpoints', { keyPath: 'localJobId' });
      open.result.createObjectStore('canary', { keyPath: 'key' });
      open.result.createObjectStore('local-deletion-receipts', { keyPath: 'broken_key' });
      archive.add(legacyRecord('rollback-session', 'hello').chunk);
    };
    open.onerror = (): void => {
      reject(open.error ?? new Error('broken database failed'));
    };
    open.onsuccess = (): void => {
      open.result.close();
      resolve();
    };
  });
}

function openDatabase(factory: IDBFactory, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open('elder-interview-audio-buffer', version);
    open.onerror = (): void => {
      reject(open.error ?? new Error('database open failed'));
    };
    open.onsuccess = (): void => {
      resolve(open.result);
    };
  });
}

async function countLegacySession(factory: IDBFactory, sessionId: string): Promise<number> {
  const database = await openDatabase(factory, 5);
  const transaction = database.transaction('chunks', 'readonly');
  const request = transaction.objectStore('chunks').index('by-session').count(sessionId);
  const count = await new Promise<number>((resolve, reject) => {
    request.onerror = (): void => {
      reject(request.error ?? new Error('count failed'));
    };
    request.onsuccess = (): void => {
      resolve(request.result);
    };
  });
  database.close();
  return count;
}
