import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ApiConfigValue } from '../api-config.js';
import type { AudioChunk, AudioObject } from '../generated/prisma/client.js';
import { AudioIntegrityService } from './audio-integrity.service.js';
import { canonicalAudioManifestChecksum } from './audio-manifest.js';
import { LocalAudioStorageAdapter } from './local-audio-storage.adapter.js';

const roots: string[] = [];

class FaultInjectingStorageAdapter extends LocalAudioStorageAdapter {
  public cleanupFails = false;
  public failure: 'link' | 'sync' | 'write' | undefined;
  public readonly failureError = new Error('injected storage failure');

  protected override async writeTemporary(handle: FileHandle, bytes: Buffer): Promise<void> {
    if (this.failure === 'write') throw this.failureError;
    await super.writeTemporary(handle, bytes);
  }

  protected override async syncTemporary(handle: FileHandle): Promise<void> {
    if (this.failure === 'sync') throw this.failureError;
    await super.syncTemporary(handle);
  }

  protected override async linkTemporary(temporary: string, target: string): Promise<void> {
    if (this.failure === 'link') throw this.failureError;
    await super.linkTemporary(temporary, target);
  }

  protected override async removeTemporary(temporary: string): Promise<void> {
    await super.removeTemporary(temporary);
    if (this.cleanupFails) throw new Error('injected cleanup failure');
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })),
  );
});

describe('LocalAudioStorageAdapter', () => {
  it('atomically creates an immutable object and never overwrites it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'elder-audio-unit-'));
    roots.push(root);
    const adapter = new LocalAudioStorageAdapter({ audioStorageRoot: root } as ApiConfigValue);
    const key = '00000000-0000-4000-8000-000000000001/0.bin';
    const original = Buffer.from('fictional-audio-chunk-one');
    const first = await adapter.putImmutable(key, original);
    const repeated = await adapter.putImmutable(key, original);
    const conflicting = await adapter.putImmutable(key, Buffer.from('different-fictional-bytes'));

    expect(first.created).toBe(true);
    expect(repeated).toMatchObject({ checksum: first.checksum, created: false });
    expect(conflicting.created).toBe(false);
    expect(conflicting.checksum).toBe(first.checksum);
    expect(await adapter.inspect(key)).toEqual({
      checksum: first.checksum,
      sizeBytes: original.byteLength,
    });
  });

  it('rejects internal keys that could escape the private root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'elder-audio-unit-'));
    roots.push(root);
    const adapter = new LocalAudioStorageAdapter({ audioStorageRoot: root } as ApiConfigValue);
    await expect(adapter.putImmutable('../outside.bin', Buffer.from('x'))).rejects.toThrow(
      'Invalid internal audio object key',
    );
  });

  it.each(['write', 'sync', 'link'] as const)(
    'removes the temporary object when %s fails',
    async (failure) => {
      const root = await mkdtemp(join(tmpdir(), 'elder-audio-unit-'));
      roots.push(root);
      const adapter = new FaultInjectingStorageAdapter({
        audioStorageRoot: root,
      } as ApiConfigValue);
      adapter.failure = failure;
      const objectId = '00000000-0000-4000-8000-000000000002';

      await expect(
        adapter.putImmutable(`${objectId}/0.bin`, Buffer.from('fictional-failing-audio')),
      ).rejects.toBe(adapter.failureError);
      await expect(readdir(join(root, objectId))).resolves.toEqual([]);
    },
  );

  it('does not replace an operation failure with a cleanup failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'elder-audio-unit-'));
    roots.push(root);
    const adapter = new FaultInjectingStorageAdapter({ audioStorageRoot: root } as ApiConfigValue);
    adapter.failure = 'write';
    adapter.cleanupFails = true;

    await expect(
      adapter.putImmutable(
        '00000000-0000-4000-8000-000000000007/0.bin',
        Buffer.from('fictional-failing-audio'),
      ),
    ).rejects.toBe(adapter.failureError);
  });

  it('re-inspects persisted bytes when verifying a completed manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'elder-audio-unit-'));
    roots.push(root);
    const adapter = new LocalAudioStorageAdapter({ audioStorageRoot: root } as ApiConfigValue);
    const integrity = new AudioIntegrityService(adapter);
    const objectId = '00000000-0000-4000-8000-000000000003';
    const key = `${objectId}/0.bin`;
    const bytes = Buffer.from('fictional-complete-consent-audio');
    const stored = await adapter.putImmutable(key, bytes);
    const now = new Date('2026-08-04T08:00:00.000Z');
    const chunk = {
      audioObjectId: objectId,
      checksum: stored.checksum,
      createdAt: now,
      endMs: 5000,
      id: '00000000-0000-4000-8000-000000000004',
      mimeType: 'audio/webm;codecs=opus',
      objectKey: key,
      retryCount: 0,
      sequenceNo: 0,
      sizeBytes: bytes.byteLength,
      startMs: 0,
      uploadedAt: now,
      uploadStatus: 'uploaded',
    } satisfies AudioChunk;
    const object = {
      chunkCount: 1,
      completedAt: now,
      createdAt: now,
      createdBy: '00000000-0000-4000-8000-000000000005',
      id: objectId,
      manifestChecksum: canonicalAudioManifestChecksum([chunk]),
      mimeType: chunk.mimeType,
      projectId: '00000000-0000-4000-8000-000000000006',
      purpose: 'consent',
      sessionId: null,
      status: 'complete',
      totalSizeBytes: BigInt(bytes.byteLength),
    } satisfies AudioObject;

    await expect(integrity.verifyCompleteManifest(object, [chunk])).resolves.toBeUndefined();
    await writeFile(join(root, key), Buffer.from('tampered-fictional-audio'));
    await expect(integrity.verifyCompleteManifest(object, [chunk])).rejects.toThrow(
      'Stored audio chunk does not match metadata',
    );
  });
});
