import {
  AudioBufferCapacityError,
  AudioBufferConflictError,
  AudioBufferWriteError,
} from './errors.js';
import { sameImmutableChunk } from './in-memory-audio-chunk-store.js';
import { audioChunkKey, type AudioChunkStore, type BufferedAudioChunk } from './types.js';

const DATABASE_NAME = 'elder-interview-audio-buffer';
const DATABASE_VERSION = 2;
const STORE_NAME = 'chunks';
const SESSION_INDEX = 'by-session';
const SESSION_STATE_STORE = 'session-state';

interface AudioSessionBufferState {
  nextSequenceNo: number;
  sessionId: string;
  timelineEndMs: number;
}

export class IndexedDbAudioChunkStore implements AudioChunkStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  public constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

  public async acknowledge(
    sessionId: string,
    sequenceNo: number,
    checksumSha256: string,
  ): Promise<boolean> {
    return this.write(async (transaction): Promise<boolean> => {
      const store = transaction.objectStore(STORE_NAME);
      const key = audioChunkKey(sessionId, sequenceNo);
      const existing = await request(store.get(key) as IDBRequest<BufferedAudioChunk | undefined>);
      if (existing === undefined || existing.chunk.checksumSha256 !== checksumSha256) return false;
      await request(store.delete(key));
      return true;
    });
  }

  public async get(sessionId: string, sequenceNo: number): Promise<BufferedAudioChunk | null> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const result = await request(
      transaction.objectStore(STORE_NAME).get(audioChunkKey(sessionId, sequenceNo)) as IDBRequest<
        BufferedAudioChunk | undefined
      >,
    );
    await transactionComplete(transaction);
    return result ?? null;
  }

  public async getNextSequenceNo(sessionId: string): Promise<number> {
    return (await this.getSessionProgress(sessionId)).nextSequenceNo;
  }

  public async getTimelineEndMs(sessionId: string): Promise<number> {
    return (await this.getSessionProgress(sessionId)).timelineEndMs;
  }

  private async getSessionProgress(sessionId: string): Promise<AudioSessionBufferState> {
    const database = await this.database();
    const transaction = database.transaction([STORE_NAME, SESSION_STATE_STORE], 'readonly');
    const state = await request(
      transaction.objectStore(SESSION_STATE_STORE).get(sessionId) as IDBRequest<
        AudioSessionBufferState | undefined
      >,
    );
    if (state !== undefined && Number.isFinite(state.timelineEndMs)) {
      await transactionComplete(transaction);
      return state;
    }
    const records = await request(
      transaction.objectStore(STORE_NAME).index(SESSION_INDEX).getAll(sessionId) as IDBRequest<
        BufferedAudioChunk[]
      >,
    );
    await transactionComplete(transaction);
    return records.reduce<AudioSessionBufferState>(
      (progress, record) => ({
        nextSequenceNo: Math.max(progress.nextSequenceNo, record.chunk.sequenceNo + 1),
        sessionId,
        timelineEndMs: Math.max(progress.timelineEndMs, record.chunk.endedAtMs),
      }),
      {
        nextSequenceNo: state?.nextSequenceNo ?? 0,
        sessionId,
        timelineEndMs: 0,
      },
    );
  }

  public async list(sessionId: string): Promise<BufferedAudioChunk[]> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const records = await request(
      transaction.objectStore(STORE_NAME).index(SESSION_INDEX).getAll(sessionId) as IDBRequest<
        BufferedAudioChunk[]
      >,
    );
    await transactionComplete(transaction);
    return records.sort((left, right) => left.chunk.sequenceNo - right.chunk.sequenceNo);
  }

  public async markFailed(sessionId: string, sequenceNo: number, errorCode: string): Promise<void> {
    await this.updateDelivery(sessionId, sequenceNo, (existing) => ({
      lastError: errorCode,
      retryCount: existing.delivery.retryCount + 1,
      status: 'failed',
    }));
  }

  public async markUploading(sessionId: string, sequenceNo: number): Promise<void> {
    await this.updateDelivery(sessionId, sequenceNo, (existing) => ({
      ...existing.delivery,
      lastError: null,
      status: 'uploading',
    }));
  }

  public async persistImmutable(
    record: BufferedAudioChunk,
    maximumBufferedBytes: number,
  ): Promise<BufferedAudioChunk> {
    return this.write(async (transaction): Promise<BufferedAudioChunk> => {
      const store = transaction.objectStore(STORE_NAME);
      const sessionStates = transaction.objectStore(SESSION_STATE_STORE);
      const existing = await request(
        store.get(record.chunk.key) as IDBRequest<BufferedAudioChunk | undefined>,
      );
      if (existing !== undefined) {
        if (!sameImmutableChunk(existing, record)) throw new AudioBufferConflictError();
        await advanceSequenceHighWater(sessionStates, record);
        return existing;
      }
      const records = await request(store.getAll() as IDBRequest<BufferedAudioChunk[]>);
      const bufferedBytes = records.reduce((total, item) => total + item.chunk.byteLength, 0);
      if (bufferedBytes + record.chunk.byteLength > maximumBufferedBytes) {
        throw new AudioBufferCapacityError();
      }
      await request(store.add(record));
      await advanceSequenceHighWater(sessionStates, record);
      return record;
    });
  }

  private async database(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const open = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
      open.onupgradeneeded = (): void => {
        const database = open.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'chunk.key' });
          store.createIndex(SESSION_INDEX, 'chunk.sessionId', { unique: false });
        }
        if (!database.objectStoreNames.contains(SESSION_STATE_STORE)) {
          database.createObjectStore(SESSION_STATE_STORE, { keyPath: 'sessionId' });
        }
      };
      open.onerror = (): void => {
        reject(new AudioBufferWriteError(open.error));
      };
      open.onblocked = (): void => {
        reject(new AudioBufferWriteError(new Error('IndexedDB upgrade blocked')));
      };
      open.onsuccess = (): void => {
        resolve(open.result);
      };
    });
    return this.databasePromise;
  }

  private async updateDelivery(
    sessionId: string,
    sequenceNo: number,
    update: (existing: BufferedAudioChunk) => BufferedAudioChunk['delivery'],
  ): Promise<void> {
    await this.write(async (transaction): Promise<void> => {
      const store = transaction.objectStore(STORE_NAME);
      const key = audioChunkKey(sessionId, sequenceNo);
      const existing = await request(store.get(key) as IDBRequest<BufferedAudioChunk | undefined>);
      if (existing === undefined) throw new Error('audio chunk not found');
      await request(store.put({ chunk: existing.chunk, delivery: update(existing) }));
    });
  }

  private async write<T>(operation: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
    try {
      const database = await this.database();
      const transaction = database.transaction([STORE_NAME, SESSION_STATE_STORE], 'readwrite');
      const completion = transactionComplete(transaction);
      const result = await operation(transaction);
      await completion;
      return result;
    } catch (error) {
      if (error instanceof AudioBufferCapacityError || error instanceof AudioBufferConflictError) {
        throw error;
      }
      if (isQuotaError(error)) throw new AudioBufferCapacityError();
      if (error instanceof AudioBufferWriteError) throw error;
      throw new AudioBufferWriteError(error);
    }
  }
}

async function advanceSequenceHighWater(
  store: IDBObjectStore,
  record: BufferedAudioChunk,
): Promise<void> {
  const existing = await request(
    store.get(record.chunk.sessionId) as IDBRequest<AudioSessionBufferState | undefined>,
  );
  const nextSequenceNo = Math.max(existing?.nextSequenceNo ?? 0, record.chunk.sequenceNo + 1);
  const timelineEndMs = Math.max(existing?.timelineEndMs ?? 0, record.chunk.endedAtMs);
  await request(store.put({ nextSequenceNo, sessionId: record.chunk.sessionId, timelineEndMs }));
}

function request<T = undefined>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = (): void => {
      resolve(value.result);
    };
    value.onerror = (): void => {
      reject(value.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = (): void => {
      resolve();
    };
    transaction.onabort = (): void => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
    transaction.onerror = (): void => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    };
  });
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}
