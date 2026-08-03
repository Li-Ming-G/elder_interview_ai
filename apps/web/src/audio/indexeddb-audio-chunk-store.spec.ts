// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { IndexedDbAudioChunkStore } from './indexeddb-audio-chunk-store.js';

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
});
