// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { AudioManifestResponse, InterviewSessionResponse } from '@elder-interview/contracts';

import type { ReviewApi } from '../interview/interview-api.js';
import { AudioChunkQueue } from './audio-chunk-queue.js';
import { IndexedDbAudioChunkStore } from './indexeddb-audio-chunk-store.js';
import { LocalAudioArchiveService } from './local-audio-archive.js';

const SESSION_ID = '00000000-0000-4000-8000-000000000008';
const PROJECT_ID = '00000000-0000-4000-8000-000000000009';
const AUDIO_ID = '00000000-0000-4000-8000-000000000010';
const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

describe('LocalAudioArchiveService', () => {
  it('projects and exposes playback only after fresh full archive verification', async () => {
    const fixture = await createFixture();
    const createdUrls: Blob[] = [];
    const revoked: string[] = [];
    const service = new LocalAudioArchiveService(fixture.api, fixture.store, {
      createObjectURL: (blob): string => {
        createdUrls.push(blob);
        return 'blob:verified';
      },
      revokeObjectURL: (url): void => {
        revoked.push(url);
      },
      storage: {
        estimate: (): Promise<{ quota: number; usage: number }> =>
          Promise.resolve({ quota: 1_000, usage: 100 }),
      },
    });

    expect((await fixture.store.inspectLocalArchive(SESSION_ID)).archive[0]).toMatchObject({
      blob: { size: 5, type: 'audio/webm' },
      byteLength: 5,
      checksumSha256: HELLO_SHA256,
      endedAtMs: 1_000,
      mimeType: 'audio/webm',
      sequenceNo: 0,
      startedAtMs: 0,
    });

    await expect(service.project(SESSION_ID)).resolves.toMatchObject({
      archive_bytes: 5,
      archive_chunk_count: 1,
      origin_storage: { available_bytes: 900, quota_bytes: 1_000, usage_bytes: 100 },
      playback_available: true,
      state: 'available_complete',
      state_basis: { local_archive_complete: true, server_manifest_verified: true },
    });
    const playback = await service.createPlayback(SESSION_ID);
    expect(playback).toMatchObject({ mimeType: 'audio/webm', url: 'blob:verified' });
    expect(createdUrls).toHaveLength(1);
    playback?.revoke();
    expect(revoked).toEqual(['blob:verified']);
  });

  it('shows missing chunks as incomplete and never creates partial playback', async () => {
    const fixture = await createFixture();
    fixture.manifest.chunk_count = 2;
    fixture.manifest.total_size_bytes = 10;
    fixture.manifest.chunks.push({
      ...firstManifestChunk(fixture.manifest),
      end_ms: 2_000,
      sequence_no: 1,
      start_ms: 1_000,
    });
    requiredFinalization(fixture.session).expected_chunk_count = 2;
    requiredFinalization(fixture.session).total_size_bytes = 10;

    const service = new LocalAudioArchiveService(fixture.api, fixture.store);
    await expect(service.project(SESSION_ID)).resolves.toMatchObject({
      playback_available: false,
      state: 'available_incomplete',
    });
    await expect(service.createPlayback(SESSION_ID)).resolves.toBeNull();
  });

  it('fails closed on missing total bytes, offline manifest, and local checksum mismatch', async () => {
    const missing = await createFixture();
    delete requiredFinalization(missing.session).total_size_bytes;
    await expect(
      new LocalAudioArchiveService(missing.api, missing.store).project(SESSION_ID),
    ).resolves.toMatchObject({ state: 'blocked_server_unverified' });

    const offline = await createFixture();
    offline.api.getAudioManifest = vi.fn((): Promise<AudioManifestResponse> =>
      Promise.reject(new Error('offline')),
    );
    await expect(
      new LocalAudioArchiveService(offline.api, offline.store).project(SESSION_ID),
    ).resolves.toMatchObject({ state: 'blocked_server_unverified' });

    const mismatch = await createFixture();
    firstManifestChunk(mismatch.manifest).checksum = 'f'.repeat(64);
    await expect(
      new LocalAudioArchiveService(mismatch.api, mismatch.store).project(SESSION_ID),
    ).resolves.toMatchObject({ state: 'blocked_server_unverified' });
  });

  it('atomically deletes the local copy, writes one stable receipt, and keeps server facts', async () => {
    const fixture = await createFixture();
    const release = vi.fn((): Promise<void> => Promise.resolve());
    const lock = {
      acquire: vi.fn((): Promise<boolean> => Promise.resolve(true)),
      release,
    };
    const service = new LocalAudioArchiveService(fixture.api, fixture.store, {
      createLock: (): typeof lock => lock,
      now: (): Date => new Date('2026-08-12T08:00:00.000Z'),
    });

    await expect(service.delete(SESSION_ID)).resolves.toEqual({
      contract_version: 'local-audio-archive-v1',
      deleted_at: '2026-08-12T08:00:00.000Z',
      kind: 'delete_result',
      result: 'deleted',
      server_audio_retained: true,
      server_memory_retained: true,
      server_transcript_retained: true,
      session_id: SESSION_ID,
    });
    await expect(service.project(SESSION_ID)).resolves.toMatchObject({
      archive_bytes: 0,
      state: 'deleted_on_device',
    });
    await expect(service.delete(SESSION_ID)).resolves.toMatchObject({
      deleted_at: '2026-08-12T08:00:00.000Z',
      result: 'already_deleted',
    });
    expect(fixture.getSessionCallCount()).toBe(1);
    expect(release.mock.calls).toHaveLength(2);
  });

  it('does zero writes when delivery is pending, capture facts are active, or lock is unavailable', async () => {
    const pending = await createFixture({ acknowledge: false });
    const service = new LocalAudioArchiveService(pending.api, pending.store, {
      createLock: (): ReturnType<typeof availableLock> => availableLock(),
    });
    await expect(service.delete(SESSION_ID)).resolves.toMatchObject({
      deleted_at: null,
      result: 'blocked_pending_delivery',
    });
    expect((await pending.store.inspectLocalArchive(SESSION_ID)).archive).toHaveLength(1);

    const active = await createFixture();
    await active.store.putUploadJob({
      audioObjectId: AUDIO_ID,
      bufferSessionId: SESSION_ID,
      chunkRequestIds: {},
      completeRequestId: null,
      createRequestId: null,
      expectedChunkCount: 1,
      interviewCapture: {
        audioObjectId: AUDIO_ID,
        audioStreamId: 'stream',
        confirmActiveRequests: {},
        generationNo: 1,
        interruptionReports: {},
        pendingResume: null,
        protocolVersion: 1,
        startRequestId: 'request',
        status: 'active',
        stopRequestId: null,
        timelineOffsetMs: 0,
      },
      jobId: `interview-capture:${SESSION_ID}`,
      lastError: null,
      mimeType: 'audio/webm',
      projectId: PROJECT_ID,
      purpose: 'interview',
      serverSessionId: SESSION_ID,
      status: 'recording',
    });
    const activeService = new LocalAudioArchiveService(active.api, active.store, {
      createLock: (): ReturnType<typeof availableLock> => availableLock(),
    });
    await expect(activeService.delete(SESSION_ID)).resolves.toMatchObject({
      result: 'blocked_active_or_dirty',
    });

    const unavailable = await createFixture();
    const unavailableService = new LocalAudioArchiveService(unavailable.api, unavailable.store, {
      createLock: (): ReturnType<typeof availableLock> => availableLock(false),
    });
    await expect(unavailableService.delete(SESSION_ID)).resolves.toMatchObject({
      deleted_at: null,
      result: 'lock_unavailable',
    });
    expect((await unavailable.store.inspectLocalArchive(SESSION_ID)).archive).toHaveLength(1);
  });

  it('allows failed complete sessions to play but never to delete', async () => {
    const fixture = await createFixture();
    fixture.session.status = 'failed';
    const service = new LocalAudioArchiveService(fixture.api, fixture.store, {
      createLock: (): ReturnType<typeof availableLock> => availableLock(),
    });
    await expect(service.project(SESSION_ID)).resolves.toMatchObject({ playback_available: true });
    await expect(service.delete(SESSION_ID)).resolves.toMatchObject({
      deleted_at: null,
      result: 'blocked_server_unverified',
    });
    expect((await fixture.store.inspectLocalArchive(SESSION_ID)).archive).toHaveLength(1);
  });
});

async function createFixture({ acknowledge = true } = {}): Promise<{
  api: ReviewApi;
  getSessionCallCount: () => number;
  manifest: AudioManifestResponse;
  session: InterviewSessionResponse;
  store: IndexedDbAudioChunkStore;
}> {
  const store = new IndexedDbAudioChunkStore(new IDBFactory());
  const queue = new AudioChunkQueue(store, {
    checksum: (): Promise<string> => Promise.resolve(HELLO_SHA256),
    maximumBufferedBytes: 1_024,
    now: (): Date => new Date('2026-08-12T00:00:00.000Z'),
  });
  await queue.enqueue({
    blob: new NodeBlob(['hello'], { type: 'audio/webm' }) as unknown as Blob,
    endedAtMs: 1_000,
    mimeType: 'audio/webm',
    sequenceNo: 0,
    sessionId: SESSION_ID,
    startedAtMs: 0,
  });
  if (acknowledge) await store.acknowledge(SESSION_ID, 0, HELLO_SHA256);

  const session = sessionResponse();
  const manifest = manifestResponse();
  const getSession = vi.fn((): Promise<InterviewSessionResponse> => Promise.resolve(session));
  const api: ReviewApi = {
    getAudioManifest: vi.fn((): Promise<AudioManifestResponse> => Promise.resolve(manifest)),
    getSession,
    listSessionTranscripts: vi.fn(() => Promise.resolve([])),
  };
  return {
    api,
    getSessionCallCount: (): number => getSession.mock.calls.length,
    manifest,
    session,
    store,
  };
}

function availableLock(acquired = true): {
  acquire: () => Promise<boolean>;
  release: () => Promise<void>;
} {
  return {
    acquire: (): Promise<boolean> => Promise.resolve(acquired),
    release: (): Promise<void> => Promise.resolve(),
  };
}

function firstManifestChunk(
  manifest: AudioManifestResponse,
): AudioManifestResponse['chunks'][number] {
  const chunk = manifest.chunks[0];
  if (chunk === undefined) throw new Error('fixture manifest chunk is missing');
  return chunk;
}

function requiredFinalization(
  session: InterviewSessionResponse,
): NonNullable<InterviewSessionResponse['finalization']> {
  const finalization = session.finalization;
  if (finalization === null || finalization === undefined) {
    throw new Error('fixture finalization is missing');
  }
  return finalization;
}

function sessionResponse(): InterviewSessionResponse {
  return {
    capture: {
      audio_object_id: AUDIO_ID,
      audio_stream_id: 'stream',
      generation_no: 1,
      interrupted_at: null,
      interruption_reason: null,
      status: 'stopped',
      timeline_offset_ms: 0,
      uploaded_chunk_count: 1,
    },
    capture_failure_code: null,
    created_at: '2026-08-12T00:00:00.000Z',
    created_by: 'actor',
    duration_seconds: 1,
    ended_at: '2026-08-12T00:00:01.000Z',
    finalization: {
      audio_object_id: AUDIO_ID,
      completed_at: '2026-08-12T00:00:02.000Z',
      expected_chunk_count: 1,
      failure_code: null,
      manifest_checksum: 'manifest',
      processing_started_at: '2026-08-12T00:00:01.500Z',
      recording_status: 'stopped',
      total_size_bytes: 5,
      transcript_error_code: null,
      transcript_status: 'drained',
      upload_status: 'complete',
      uploaded_chunk_count: 1,
    },
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 1,
    started_at: '2026-08-12T00:00:00.000Z',
    status: 'completed',
    updated_at: '2026-08-12T00:00:02.000Z',
  };
}

function manifestResponse(): AudioManifestResponse {
  return {
    chunk_count: 1,
    chunks: [
      {
        checksum: HELLO_SHA256,
        end_ms: 1_000,
        mime_type: 'audio/webm',
        sequence_no: 0,
        size_bytes: 5,
        start_ms: 0,
        uploaded_at: '2026-08-12T00:00:01.000Z',
      },
    ],
    completed_at: '2026-08-12T00:00:02.000Z',
    created_at: '2026-08-12T00:00:00.000Z',
    created_by: 'actor',
    id: AUDIO_ID,
    manifest_checksum: 'manifest',
    mime_type: 'audio/webm',
    project_id: PROJECT_ID,
    purpose: 'interview',
    session_id: SESSION_ID,
    status: 'complete',
    total_size_bytes: 5,
  };
}
