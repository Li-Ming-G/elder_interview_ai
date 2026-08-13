import {
  AudioBufferCapacityError,
  AudioBufferConflictError,
  AudioBufferWriteError,
} from './errors.js';
import { sameImmutableChunk } from './in-memory-audio-chunk-store.js';
import {
  audioChunkKey,
  assertAudioUploadJobRecord,
  assertCaptureInterruptionReportRecord,
  CAPTURE_INTERRUPTION_REPORT_RECORD_TYPE,
  type AudioArchiveSnapshot,
  type AudioChunkDelivery,
  type AudioChunkStore,
  type AudioUploadJob,
  type AudioUploadJobStore,
  type CaptureInterruptionReportRecord,
  type CaptureInterruptionReportStore,
  type BrowserCaptureCheckpoint,
  type BrowserCaptureCheckpointStore,
  type BufferedAudioChunk,
  type ImmutableAudioChunk,
  sameCaptureInterruptionReportIdentity,
  sameCaptureInterruptionReportTarget,
} from './types.js';

const DATABASE_NAME = 'elder-interview-audio-buffer';
const DATABASE_VERSION = 5;
const LEGACY_CHUNK_STORE = 'chunks';
const ARCHIVE_STORE = 'archive-chunks';
const DELIVERY_STORE = 'delivery-queue';
const SESSION_INDEX = 'by-session';
const SESSION_STATE_STORE = 'session-state';
const UPLOAD_JOB_STORE = 'upload-jobs';
const CAPTURE_CHECKPOINT_STORE = 'capture-checkpoints';
const CANARY_STORE = 'canary';
const LOCAL_DELETION_RECEIPT_STORE = 'local-deletion-receipts';
const BUFFER_SESSION_INDEX = 'by-buffer-session';
const SERVER_SESSION_INDEX = 'by-server-session';
const REPORT_SESSION_INDEX = 'by-report-session';

interface AudioSessionBufferState {
  archiveByteLength?: number;
  deliveryAcknowledgedHighWaterSequenceNo?: number;
  nextSequenceNo: number;
  sessionId: string;
  timelineEndMs: number;
}

interface StoredAudioDelivery extends AudioChunkDelivery {
  key: string;
  sequenceNo: number;
  sessionId: string;
}

export interface LocalDeletionReceipt {
  contract_version: 'local-audio-archive-v1';
  deleted_at: string;
  kind: 'deletion_receipt';
  result: 'deleted';
  session_id: string;
}

export interface LocalArchiveInspection {
  activeOrDirty: boolean;
  archive: ImmutableAudioChunk[];
  pendingDeliveryCount: number;
  receipt: LocalDeletionReceipt | null;
}

export interface LocalArchiveDeletionCommit {
  receipt: LocalDeletionReceipt;
  result: 'already_deleted' | 'deleted';
}

export class IndexedDbAudioChunkStore
  implements
    AudioChunkStore,
    AudioUploadJobStore,
    BrowserCaptureCheckpointStore,
    CaptureInterruptionReportStore
{
  private databasePromise: Promise<IDBDatabase> | null = null;

  public constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

  public async acknowledge(
    sessionId: string,
    sequenceNo: number,
    checksumSha256: string,
  ): Promise<boolean> {
    return this.write(
      [ARCHIVE_STORE, DELIVERY_STORE, SESSION_STATE_STORE],
      async (transaction): Promise<boolean> => {
        const key = audioChunkKey(sessionId, sequenceNo);
        const archive = await request(
          transaction.objectStore(ARCHIVE_STORE).get(key) as IDBRequest<
            ImmutableAudioChunk | undefined
          >,
        );
        const deliveries = transaction.objectStore(DELIVERY_STORE);
        const delivery = await request(
          deliveries.get(key) as IDBRequest<StoredAudioDelivery | undefined>,
        );
        if (
          archive === undefined ||
          delivery === undefined ||
          archive.checksumSha256 !== checksumSha256
        ) {
          return false;
        }
        await request(deliveries.delete(key));
        const states = transaction.objectStore(SESSION_STATE_STORE);
        const state = await readSessionState(states, sessionId);
        await request(
          states.put({
            ...state,
            deliveryAcknowledgedHighWaterSequenceNo: Math.max(
              state.deliveryAcknowledgedHighWaterSequenceNo ?? -1,
              sequenceNo,
            ),
          }),
        );
        return true;
      },
    );
  }

  public async get(sessionId: string, sequenceNo: number): Promise<BufferedAudioChunk | null> {
    const key = audioChunkKey(sessionId, sequenceNo);
    const database = await this.database();
    const transaction = database.transaction([ARCHIVE_STORE, DELIVERY_STORE], 'readonly');
    const [chunk, storedDelivery] = await Promise.all([
      request(
        transaction.objectStore(ARCHIVE_STORE).get(key) as IDBRequest<
          ImmutableAudioChunk | undefined
        >,
      ),
      request(
        transaction.objectStore(DELIVERY_STORE).get(key) as IDBRequest<
          StoredAudioDelivery | undefined
        >,
      ),
    ]);
    await transactionComplete(transaction);
    return chunk === undefined || storedDelivery === undefined
      ? null
      : { chunk, delivery: toDelivery(storedDelivery) };
  }

  public async getArchive(
    sessionId: string,
    sequenceNo: number,
  ): Promise<ImmutableAudioChunk | null> {
    const database = await this.database();
    const transaction = database.transaction(ARCHIVE_STORE, 'readonly');
    const result = await request(
      transaction
        .objectStore(ARCHIVE_STORE)
        .get(audioChunkKey(sessionId, sequenceNo)) as IDBRequest<ImmutableAudioChunk | undefined>,
    );
    await transactionComplete(transaction);
    return result ?? null;
  }

  public async getArchiveSnapshot(sessionId: string): Promise<AudioArchiveSnapshot> {
    const database = await this.database();
    const transaction = database.transaction(
      [ARCHIVE_STORE, DELIVERY_STORE, SESSION_STATE_STORE],
      'readonly',
    );
    const [archives, deliveries, state] = await Promise.all([
      request(
        transaction.objectStore(ARCHIVE_STORE).index(SESSION_INDEX).getAll(sessionId) as IDBRequest<
          ImmutableAudioChunk[]
        >,
      ),
      request(
        transaction
          .objectStore(DELIVERY_STORE)
          .index(SESSION_INDEX)
          .getAll(sessionId) as IDBRequest<StoredAudioDelivery[]>,
      ),
      request(
        transaction.objectStore(SESSION_STATE_STORE).get(sessionId) as IDBRequest<
          AudioSessionBufferState | undefined
        >,
      ),
    ]);
    await transactionComplete(transaction);
    return {
      archiveByteLength: archives.reduce((total, chunk) => total + chunk.byteLength, 0),
      archiveChunkCount: archives.length,
      archiveHighWaterSequenceNo: (state?.nextSequenceNo ?? 0) - 1,
      deliveryAcknowledgedHighWaterSequenceNo: state?.deliveryAcknowledgedHighWaterSequenceNo ?? -1,
      pendingDeliveryCount: deliveries.length,
      timelineEndMs: state?.timelineEndMs ?? 0,
    };
  }

  public async getCaptureCheckpoint(localJobId: string): Promise<BrowserCaptureCheckpoint | null> {
    const database = await this.database();
    const transaction = database.transaction(CAPTURE_CHECKPOINT_STORE, 'readonly');
    const result = await request(
      transaction.objectStore(CAPTURE_CHECKPOINT_STORE).get(localJobId) as IDBRequest<
        BrowserCaptureCheckpoint | undefined
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

  public async getUploadJob(jobId: string): Promise<AudioUploadJob | null> {
    const database = await this.database();
    const transaction = database.transaction(UPLOAD_JOB_STORE, 'readonly');
    const result = await request(
      transaction.objectStore(UPLOAD_JOB_STORE).get(jobId) as IDBRequest<unknown>,
    );
    await transactionComplete(transaction);
    if (result === undefined) return null;
    assertAudioUploadJobRecord(result, jobId);
    return result;
  }

  public async getCaptureInterruptionReport(
    jobId: string,
  ): Promise<CaptureInterruptionReportRecord | null> {
    const database = await this.database();
    const transaction = database.transaction(UPLOAD_JOB_STORE, 'readonly');
    const result = await request(
      transaction.objectStore(UPLOAD_JOB_STORE).get(jobId) as IDBRequest<unknown>,
    );
    await transactionComplete(transaction);
    if (result === undefined) return null;
    assertCaptureInterruptionReportRecord(result, jobId);
    return result;
  }

  public async getOrCreateCaptureInterruptionReport(
    candidate: CaptureInterruptionReportRecord,
  ): Promise<CaptureInterruptionReportRecord> {
    assertCaptureInterruptionReportRecord(candidate, candidate.jobId);
    return this.write(
      [UPLOAD_JOB_STORE],
      async (transaction): Promise<CaptureInterruptionReportRecord> => {
        const records = transaction.objectStore(UPLOAD_JOB_STORE);
        const existing = await request(records.get(candidate.jobId) as IDBRequest<unknown>);
        if (existing !== undefined) {
          assertCaptureInterruptionReportRecord(existing, candidate.jobId);
          if (!sameCaptureInterruptionReportTarget(existing, candidate)) {
            throw new Error('CAPTURE_INTERRUPTION_REPORT_IDENTITY_CONFLICT');
          }
          return existing;
        }
        await request(records.add(candidate));
        return candidate;
      },
    );
  }

  public async updateCaptureInterruptionReport(
    jobId: string,
    update: (current: CaptureInterruptionReportRecord) => CaptureInterruptionReportRecord,
  ): Promise<CaptureInterruptionReportRecord> {
    return this.write(
      [UPLOAD_JOB_STORE],
      async (transaction): Promise<CaptureInterruptionReportRecord> => {
        const records = transaction.objectStore(UPLOAD_JOB_STORE);
        const current = await request(records.get(jobId) as IDBRequest<unknown>);
        if (current === undefined) throw new Error('CAPTURE_INTERRUPTION_REPORT_NOT_FOUND');
        assertCaptureInterruptionReportRecord(current, jobId);
        const original = structuredClone(current);
        const updated = update(structuredClone(current));
        assertCaptureInterruptionReportRecord(updated, jobId);
        if (!sameCaptureInterruptionReportIdentity(original, updated)) {
          throw new Error('CAPTURE_INTERRUPTION_REPORT_IDENTITY_CHANGED');
        }
        await request(records.put(updated));
        return updated;
      },
    );
  }

  public async updateUploadJob(
    jobId: string,
    update: (current: AudioUploadJob) => AudioUploadJob,
  ): Promise<AudioUploadJob> {
    return this.write([UPLOAD_JOB_STORE], async (transaction): Promise<AudioUploadJob> => {
      const jobs = transaction.objectStore(UPLOAD_JOB_STORE);
      const current = await request(jobs.get(jobId) as IDBRequest<unknown>);
      if (current === undefined) throw new Error('UPLOAD_JOB_NOT_FOUND');
      assertAudioUploadJobRecord(current, jobId);
      const updated = update(current);
      assertAudioUploadJobRecord(updated, jobId);
      await request(jobs.put(updated));
      return updated;
    });
  }

  public async list(sessionId: string): Promise<BufferedAudioChunk[]> {
    const database = await this.database();
    const transaction = database.transaction([ARCHIVE_STORE, DELIVERY_STORE], 'readonly');
    const deliveries = await request(
      transaction.objectStore(DELIVERY_STORE).index(SESSION_INDEX).getAll(sessionId) as IDBRequest<
        StoredAudioDelivery[]
      >,
    );
    const archives = transaction.objectStore(ARCHIVE_STORE);
    const records = await Promise.all(
      deliveries.map(async (delivery): Promise<BufferedAudioChunk | null> => {
        const chunk = await request(
          archives.get(delivery.key) as IDBRequest<ImmutableAudioChunk | undefined>,
        );
        return chunk === undefined ? null : { chunk, delivery: toDelivery(delivery) };
      }),
    );
    await transactionComplete(transaction);
    return records
      .filter((record): record is BufferedAudioChunk => record !== null)
      .sort((left, right) => left.chunk.sequenceNo - right.chunk.sequenceNo);
  }

  public async listArchive(sessionId: string): Promise<ImmutableAudioChunk[]> {
    const database = await this.database();
    const transaction = database.transaction(ARCHIVE_STORE, 'readonly');
    const records = await request(
      transaction.objectStore(ARCHIVE_STORE).index(SESSION_INDEX).getAll(sessionId) as IDBRequest<
        ImmutableAudioChunk[]
      >,
    );
    await transactionComplete(transaction);
    return records.sort((left, right) => left.sequenceNo - right.sequenceNo);
  }

  public async markFailed(sessionId: string, sequenceNo: number, errorCode: string): Promise<void> {
    await this.updateDelivery(sessionId, sequenceNo, (existing) => ({
      lastError: errorCode,
      retryCount: existing.retryCount + 1,
      status: 'failed',
    }));
  }

  public async markUploading(sessionId: string, sequenceNo: number): Promise<void> {
    await this.updateDelivery(sessionId, sequenceNo, (existing) => ({
      ...existing,
      lastError: null,
      status: 'uploading',
    }));
  }

  public async persistImmutable(
    record: BufferedAudioChunk,
    maximumBufferedBytes: number,
  ): Promise<BufferedAudioChunk> {
    return this.write(
      [ARCHIVE_STORE, DELIVERY_STORE, SESSION_STATE_STORE],
      async (transaction): Promise<BufferedAudioChunk> => {
        const archives = transaction.objectStore(ARCHIVE_STORE);
        const deliveries = transaction.objectStore(DELIVERY_STORE);
        const states = transaction.objectStore(SESSION_STATE_STORE);
        const existing = await request(
          archives.get(record.chunk.key) as IDBRequest<ImmutableAudioChunk | undefined>,
        );
        if (existing !== undefined) {
          if (!sameImmutableChunk(existing, record.chunk)) throw new AudioBufferConflictError();
          const delivery = await request(
            deliveries.get(record.chunk.key) as IDBRequest<StoredAudioDelivery | undefined>,
          );
          return {
            chunk: existing,
            delivery: delivery === undefined ? record.delivery : toDelivery(delivery),
          };
        }
        const state = await readSessionState(states, record.chunk.sessionId);
        const archiveByteLength =
          state.archiveByteLength ??
          (
            await request(
              archives.index(SESSION_INDEX).getAll(record.chunk.sessionId) as IDBRequest<
                ImmutableAudioChunk[]
              >,
            )
          ).reduce((total, chunk) => total + chunk.byteLength, 0);
        if (archiveByteLength + record.chunk.byteLength > maximumBufferedBytes) {
          throw new AudioBufferCapacityError();
        }
        await request(archives.add(record.chunk));
        await request(deliveries.add(toStoredDelivery(record)));
        await request(
          states.put({
            ...state,
            archiveByteLength: archiveByteLength + record.chunk.byteLength,
            nextSequenceNo: Math.max(state.nextSequenceNo, record.chunk.sequenceNo + 1),
            timelineEndMs: Math.max(state.timelineEndMs, record.chunk.endedAtMs),
          }),
        );
        return record;
      },
    );
  }

  public async putCaptureCheckpoint(checkpoint: BrowserCaptureCheckpoint): Promise<void> {
    await this.simplePut(CAPTURE_CHECKPOINT_STORE, checkpoint);
  }

  public async putUploadJob(job: AudioUploadJob): Promise<void> {
    assertAudioUploadJobRecord(job, job.jobId);
    await this.simplePut(UPLOAD_JOB_STORE, job);
  }

  public async inspectLocalArchive(sessionId: string): Promise<LocalArchiveInspection> {
    const database = await this.database();
    const storeNames = localArchiveStoreNames(database);
    const transaction = database.transaction(storeNames, 'readonly');
    const result = await readLocalArchiveInspection(transaction, sessionId);
    await transactionComplete(transaction);
    return result;
  }

  public async deleteLocalArchive(
    sessionId: string,
    expectedArchive: readonly ImmutableAudioChunk[],
    deletedAt: string,
  ): Promise<LocalArchiveDeletionCommit> {
    let transaction: IDBTransaction | null = null;
    let completion: Promise<void> | null = null;
    try {
      const database = await this.database();
      const storeNames = localArchiveStoreNames(database);
      transaction = database.transaction(storeNames, 'readwrite');
      completion = transactionComplete(transaction);
      const current = await readLocalArchiveInspection(transaction, sessionId);
      if (current.activeOrDirty) throw new Error('LOCAL_ARCHIVE_ACTIVE_OR_DIRTY');
      if (current.pendingDeliveryCount > 0) throw new Error('LOCAL_ARCHIVE_PENDING_DELIVERY');
      if (!sameArchiveIdentity(current.archive, expectedArchive)) {
        throw new Error('LOCAL_ARCHIVE_CHANGED_DURING_PREFLIGHT');
      }
      if (current.receipt !== null && current.archive.length === 0) {
        await completion;
        return { receipt: current.receipt, result: 'already_deleted' };
      }
      if (current.archive.length === 0) throw new Error('LOCAL_ARCHIVE_NOT_FOUND');

      await deleteBySessionIndex(transaction.objectStore(ARCHIVE_STORE), SESSION_INDEX, sessionId);
      await deleteBySessionIndex(transaction.objectStore(DELIVERY_STORE), SESSION_INDEX, sessionId);
      await request(transaction.objectStore(SESSION_STATE_STORE).delete(sessionId));
      await deleteMatching(transaction.objectStore(UPLOAD_JOB_STORE), (value, key) => {
        if (key === `interview-capture:${sessionId}`) return true;
        return (
          isRecord(value) &&
          value.recordType === CAPTURE_INTERRUPTION_REPORT_RECORD_TYPE &&
          value.sessionId === sessionId
        );
      });
      await deleteMatching(
        transaction.objectStore(CAPTURE_CHECKPOINT_STORE),
        (value, key) =>
          key === `interview-capture:${sessionId}` ||
          (isRecord(value) && value.sessionId === sessionId),
      );
      if (transaction.objectStoreNames.contains(LEGACY_CHUNK_STORE)) {
        await deleteMatching(
          transaction.objectStore(LEGACY_CHUNK_STORE),
          (value) =>
            isRecord(value) && isRecord(value.chunk) && value.chunk.sessionId === sessionId,
        );
      }
      const receipt: LocalDeletionReceipt = {
        contract_version: 'local-audio-archive-v1',
        deleted_at: deletedAt,
        kind: 'deletion_receipt',
        result: 'deleted',
        session_id: sessionId,
      };
      await request(transaction.objectStore(LOCAL_DELETION_RECEIPT_STORE).put(receipt));
      await completion;
      return { receipt, result: 'deleted' };
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A request-level failure may already have aborted or completed the transaction.
      }
      try {
        await completion;
      } catch {
        // The public error below deliberately hides IndexedDB implementation details.
      }
      if (error instanceof AudioBufferWriteError) throw error;
      throw new AudioBufferWriteError(error);
    }
  }

  public async runCanary(): Promise<void> {
    try {
      const database = await this.database();
      const transaction = database.transaction(CANARY_STORE, 'readwrite');
      const completion = transactionComplete(transaction);
      const store = transaction.objectStore(CANARY_STORE);
      const key = `canary:${globalThis.crypto.randomUUID()}`;
      await request(store.put({ key, value: 1 }));
      await request(store.delete(key));
      await completion;
    } catch (error) {
      if (isQuotaError(error)) throw new AudioBufferCapacityError();
      if (error instanceof AudioBufferWriteError) throw error;
      throw new AudioBufferWriteError(error);
    }
  }

  private async database(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const open = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
      open.onupgradeneeded = (event): void => {
        const database = open.result;
        const transaction = open.transaction;
        if (transaction === null) throw new Error('IndexedDB upgrade transaction missing');
        if (!database.objectStoreNames.contains(ARCHIVE_STORE)) {
          const archive = database.createObjectStore(ARCHIVE_STORE, { keyPath: 'key' });
          archive.createIndex(SESSION_INDEX, 'sessionId', { unique: false });
        }
        if (!database.objectStoreNames.contains(DELIVERY_STORE)) {
          const delivery = database.createObjectStore(DELIVERY_STORE, { keyPath: 'key' });
          delivery.createIndex(SESSION_INDEX, 'sessionId', { unique: false });
        }
        if (!database.objectStoreNames.contains(SESSION_STATE_STORE)) {
          database.createObjectStore(SESSION_STATE_STORE, { keyPath: 'sessionId' });
        }
        if (!database.objectStoreNames.contains(UPLOAD_JOB_STORE)) {
          database.createObjectStore(UPLOAD_JOB_STORE, { keyPath: 'jobId' });
        }
        if (!database.objectStoreNames.contains(CAPTURE_CHECKPOINT_STORE)) {
          database.createObjectStore(CAPTURE_CHECKPOINT_STORE, { keyPath: 'localJobId' });
        }
        if (!database.objectStoreNames.contains(CANARY_STORE)) {
          database.createObjectStore(CANARY_STORE, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(LOCAL_DELETION_RECEIPT_STORE)) {
          database.createObjectStore(LOCAL_DELETION_RECEIPT_STORE, { keyPath: 'session_id' });
        }
        const jobs = transaction.objectStore(UPLOAD_JOB_STORE);
        ensureIndex(jobs, BUFFER_SESSION_INDEX, 'bufferSessionId');
        ensureIndex(jobs, SERVER_SESSION_INDEX, 'serverSessionId');
        ensureIndex(jobs, REPORT_SESSION_INDEX, 'sessionId');
        ensureIndex(transaction.objectStore(CAPTURE_CHECKPOINT_STORE), SESSION_INDEX, 'sessionId');
        if (database.objectStoreNames.contains(LEGACY_CHUNK_STORE) && event.oldVersion < 4) {
          migrateLegacyChunks(transaction);
        }
      };
      open.onerror = (): void => {
        reject(new AudioBufferWriteError(open.error));
      };
      open.onblocked = (): void => {
        reject(new AudioBufferWriteError(new Error('IndexedDB upgrade blocked')));
      };
      open.onsuccess = (): void => {
        open.result.onversionchange = (): void => {
          open.result.close();
          this.databasePromise = null;
        };
        resolve(open.result);
      };
    });
    return this.databasePromise;
  }

  private async getSessionProgress(sessionId: string): Promise<AudioSessionBufferState> {
    const database = await this.database();
    const transaction = database.transaction([ARCHIVE_STORE, SESSION_STATE_STORE], 'readonly');
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
      transaction.objectStore(ARCHIVE_STORE).index(SESSION_INDEX).getAll(sessionId) as IDBRequest<
        ImmutableAudioChunk[]
      >,
    );
    await transactionComplete(transaction);
    return records.reduce<AudioSessionBufferState>(
      (progress, chunk) => ({
        ...progress,
        nextSequenceNo: Math.max(progress.nextSequenceNo, chunk.sequenceNo + 1),
        timelineEndMs: Math.max(progress.timelineEndMs, chunk.endedAtMs),
      }),
      emptySessionState(sessionId),
    );
  }

  private async simplePut(storeName: string, value: unknown): Promise<void> {
    try {
      const database = await this.database();
      const transaction = database.transaction(storeName, 'readwrite');
      const completion = transactionComplete(transaction);
      await request(transaction.objectStore(storeName).put(value));
      await completion;
    } catch (error) {
      if (isQuotaError(error)) throw new AudioBufferCapacityError();
      if (error instanceof AudioBufferWriteError) throw error;
      throw new AudioBufferWriteError(error);
    }
  }

  private async updateDelivery(
    sessionId: string,
    sequenceNo: number,
    update: (existing: AudioChunkDelivery) => AudioChunkDelivery,
  ): Promise<void> {
    await this.write([DELIVERY_STORE], async (transaction): Promise<void> => {
      const store = transaction.objectStore(DELIVERY_STORE);
      const key = audioChunkKey(sessionId, sequenceNo);
      const existing = await request(store.get(key) as IDBRequest<StoredAudioDelivery | undefined>);
      if (existing === undefined) throw new Error('audio delivery not found');
      await request(store.put({ ...existing, ...update(toDelivery(existing)) }));
    });
  }

  private async write<T>(
    storeNames: string[],
    operation: (transaction: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      const database = await this.database();
      const transaction = database.transaction(storeNames, 'readwrite');
      const completion = transactionComplete(transaction);
      const result = await operation(transaction);
      await completion;
      return result;
    } catch (error) {
      if (error instanceof AudioBufferCapacityError || error instanceof AudioBufferConflictError) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.message.startsWith('CAPTURE_INTERRUPTION_REPORT_') ||
          error.message.startsWith('UPLOAD_JOB_RECORD_'))
      ) {
        throw error;
      }
      if (isQuotaError(error)) throw new AudioBufferCapacityError();
      if (error instanceof AudioBufferWriteError) throw error;
      throw new AudioBufferWriteError(error);
    }
  }
}

function emptySessionState(sessionId: string): AudioSessionBufferState {
  return {
    archiveByteLength: 0,
    deliveryAcknowledgedHighWaterSequenceNo: -1,
    nextSequenceNo: 0,
    sessionId,
    timelineEndMs: 0,
  };
}

async function readSessionState(
  store: IDBObjectStore,
  sessionId: string,
): Promise<AudioSessionBufferState> {
  return (
    (await request(store.get(sessionId) as IDBRequest<AudioSessionBufferState | undefined>)) ??
    emptySessionState(sessionId)
  );
}

function migrateLegacyChunks(transaction: IDBTransaction): void {
  const legacy = transaction.objectStore(LEGACY_CHUNK_STORE);
  const archives = transaction.objectStore(ARCHIVE_STORE);
  const deliveries = transaction.objectStore(DELIVERY_STORE);
  const cursorRequest = legacy.openCursor();
  cursorRequest.onsuccess = (): void => {
    const cursor = cursorRequest.result;
    if (cursor === null) return;
    const record = cursor.value as BufferedAudioChunk;
    archives.put(record.chunk);
    deliveries.put(toStoredDelivery(record));
    cursor.continue();
  };
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string): void {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
}

function localArchiveStoreNames(database: IDBDatabase): string[] {
  return [
    ARCHIVE_STORE,
    DELIVERY_STORE,
    SESSION_STATE_STORE,
    UPLOAD_JOB_STORE,
    CAPTURE_CHECKPOINT_STORE,
    LOCAL_DELETION_RECEIPT_STORE,
    ...(database.objectStoreNames.contains(LEGACY_CHUNK_STORE) ? [LEGACY_CHUNK_STORE] : []),
  ];
}

async function readLocalArchiveInspection(
  transaction: IDBTransaction,
  sessionId: string,
): Promise<LocalArchiveInspection> {
  const [archive, deliveries, jobs, checkpoints, receiptValue] = await Promise.all([
    request(
      transaction.objectStore(ARCHIVE_STORE).index(SESSION_INDEX).getAll(sessionId) as IDBRequest<
        ImmutableAudioChunk[]
      >,
    ),
    request(
      transaction.objectStore(DELIVERY_STORE).index(SESSION_INDEX).getAll(sessionId) as IDBRequest<
        StoredAudioDelivery[]
      >,
    ),
    request(transaction.objectStore(UPLOAD_JOB_STORE).getAll() as IDBRequest<unknown[]>),
    request(transaction.objectStore(CAPTURE_CHECKPOINT_STORE).getAll() as IDBRequest<unknown[]>),
    request(
      transaction.objectStore(LOCAL_DELETION_RECEIPT_STORE).get(sessionId) as IDBRequest<unknown>,
    ),
  ]);
  const receipt = receiptValue === undefined ? null : parseDeletionReceipt(receiptValue, sessionId);
  return {
    activeOrDirty:
      jobs.some((value) => unsafeJobBlocksDeletion(value, sessionId)) ||
      checkpoints.some((value) => unsafeCheckpointBlocksDeletion(value, sessionId)),
    archive: archive.sort((left, right) => left.sequenceNo - right.sequenceNo),
    pendingDeliveryCount: deliveries.length,
    receipt,
  };
}

function unsafeJobBlocksDeletion(value: unknown, sessionId: string): boolean {
  if (!isRecord(value)) return false;
  if (
    value.recordType === CAPTURE_INTERRUPTION_REPORT_RECORD_TYPE &&
    value.sessionId === sessionId
  ) {
    return value.status !== 'acknowledged';
  }
  if (value.jobId !== `interview-capture:${sessionId}`) return false;
  try {
    assertAudioUploadJobRecord(value, `interview-capture:${sessionId}`);
  } catch {
    return true;
  }
  const capture = value.interviewCapture;
  return (
    value.status !== 'complete' ||
    capture === undefined ||
    capture.status !== 'stopped' ||
    capture.pendingResume !== null
  );
}

function unsafeCheckpointBlocksDeletion(value: unknown, sessionId: string): boolean {
  if (!isRecord(value)) return false;
  const targetsSession =
    value.localJobId === `interview-capture:${sessionId}` || value.sessionId === sessionId;
  if (!targetsSession) return false;
  return value.status !== 'stopped' || value.dirty !== false;
}

function parseDeletionReceipt(value: unknown, sessionId: string): LocalDeletionReceipt {
  if (
    !isRecord(value) ||
    value.contract_version !== 'local-audio-archive-v1' ||
    value.kind !== 'deletion_receipt' ||
    value.result !== 'deleted' ||
    value.session_id !== sessionId ||
    typeof value.deleted_at !== 'string' ||
    !Number.isFinite(Date.parse(value.deleted_at))
  ) {
    throw new Error('LOCAL_DELETION_RECEIPT_INVALID');
  }
  return value as unknown as LocalDeletionReceipt;
}

function sameArchiveIdentity(
  left: readonly ImmutableAudioChunk[],
  right: readonly ImmutableAudioChunk[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((chunk, index) => {
    const expected = right[index];
    return (
      expected !== undefined &&
      chunk.key === expected.key &&
      chunk.sessionId === expected.sessionId &&
      chunk.sequenceNo === expected.sequenceNo &&
      chunk.byteLength === expected.byteLength &&
      chunk.checksumSha256 === expected.checksumSha256 &&
      chunk.mimeType === expected.mimeType &&
      chunk.startedAtMs === expected.startedAtMs &&
      chunk.endedAtMs === expected.endedAtMs
    );
  });
}

async function deleteBySessionIndex(
  store: IDBObjectStore,
  indexName: string,
  sessionId: string,
): Promise<void> {
  const keys = await request(store.index(indexName).getAllKeys(sessionId));
  await Promise.all(keys.map(async (key) => request(store.delete(key))));
}

function deleteMatching(
  store: IDBObjectStore,
  predicate: (value: unknown, key: IDBValidKey) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursorRequest = store.openCursor();
    cursorRequest.onerror = (): void => {
      reject(cursorRequest.error ?? new Error('IndexedDB cursor failed'));
    };
    cursorRequest.onsuccess = (): void => {
      const cursor = cursorRequest.result;
      if (cursor === null) {
        resolve();
        return;
      }
      if (predicate(cursor.value, cursor.primaryKey)) cursor.delete();
      cursor.continue();
    };
  });
}

function toStoredDelivery(record: BufferedAudioChunk): StoredAudioDelivery {
  return {
    ...record.delivery,
    key: record.chunk.key,
    sequenceNo: record.chunk.sequenceNo,
    sessionId: record.chunk.sessionId,
  };
}

function toDelivery(record: StoredAudioDelivery): AudioChunkDelivery {
  return {
    lastError: record.lastError,
    retryCount: record.retryCount,
    status: record.status,
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
