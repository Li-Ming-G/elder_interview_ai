import type {
  AudioManifestChunk,
  AudioManifestResponse,
  InterviewSessionResponse,
} from '@elder-interview/contracts';

import type { ReviewApi } from '../interview/interview-api.js';
import {
  IndexedDbAudioChunkStore,
  type LocalArchiveInspection,
} from './indexeddb-audio-chunk-store.js';
import { SessionBrowserLock } from './session-browser-lock.js';
import type { ImmutableAudioChunk } from './types.js';

const CONTRACT_VERSION = 'local-audio-archive-v1' as const;

export type LocalArchiveState =
  | 'available_complete'
  | 'available_incomplete'
  | 'blocked_active_or_dirty'
  | 'blocked_pending_delivery'
  | 'blocked_server_unverified'
  | 'deleted_on_device'
  | 'missing_unknown';

export interface LocalAudioArchiveProjection {
  archive_bytes: number;
  archive_chunk_count: number;
  contract_version: typeof CONTRACT_VERSION;
  kind: 'projection';
  origin_storage: {
    accuracy: 'origin_wide_approximate';
    available_bytes: number | null;
    quota_bytes: number | null;
    usage_bytes: number | null;
  };
  pending_delivery_count: number;
  playback_available: boolean;
  server_audio_retained: true;
  session_id: string;
  state: LocalArchiveState;
  state_basis: {
    active_or_dirty: boolean;
    deletion_receipt_present: boolean;
    local_archive_complete: boolean;
    server_manifest_verified: boolean;
  };
}

export type LocalDeleteResultCode =
  | 'already_deleted'
  | 'blocked_active_or_dirty'
  | 'blocked_pending_delivery'
  | 'blocked_server_unverified'
  | 'deleted'
  | 'lock_unavailable'
  | 'transaction_aborted';

export interface LocalAudioDeleteResult {
  contract_version: typeof CONTRACT_VERSION;
  deleted_at: string | null;
  kind: 'delete_result';
  result: LocalDeleteResultCode;
  server_audio_retained: true;
  server_memory_retained: true;
  server_transcript_retained: true;
  session_id: string;
}

export interface LocalPlayback {
  mimeType: string;
  revoke: () => void;
  url: string;
}

interface VerifiedArchive {
  archive: ImmutableAudioChunk[];
  inspection: LocalArchiveInspection;
  localComplete: boolean;
  serverManifestVerified: boolean;
  session: InterviewSessionResponse | null;
}

interface StorageManagerLike {
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
}

interface LocalAudioArchiveServiceOptions {
  createLock?: (sessionId: string) => Pick<SessionBrowserLock, 'acquire' | 'release'>;
  createObjectURL?: (blob: Blob) => string;
  crypto?: Crypto;
  now?: () => Date;
  revokeObjectURL?: (url: string) => void;
  storage?: StorageManagerLike | null;
}

export class LocalAudioArchiveService {
  public constructor(
    private readonly api: ReviewApi,
    private readonly store = new IndexedDbAudioChunkStore(),
    private readonly options: LocalAudioArchiveServiceOptions = {},
  ) {}

  public async project(sessionId: string): Promise<LocalAudioArchiveProjection> {
    const verified = await this.verify(sessionId);
    return this.toProjection(sessionId, verified, await this.storageEstimate());
  }

  public async createPlayback(sessionId: string): Promise<LocalPlayback | null> {
    const verified = await this.verify(sessionId);
    const projection = this.toProjection(sessionId, verified, await this.storageEstimate());
    if (!projection.playback_available || verified.archive.length === 0) return null;
    const mimeType = verified.archive[0]?.mimeType ?? '';
    const blob = new Blob(
      verified.archive.map((chunk) => chunk.blob),
      { type: mimeType },
    );
    const createObjectURL =
      this.options.createObjectURL ?? ((value: Blob): string => URL.createObjectURL(value));
    const revokeObjectURL =
      this.options.revokeObjectURL ??
      ((value: string): void => {
        URL.revokeObjectURL(value);
      });
    const url = createObjectURL(blob);
    return {
      mimeType,
      revoke: (): void => {
        revokeObjectURL(url);
      },
      url,
    };
  }

  public async delete(sessionId: string): Promise<LocalAudioDeleteResult> {
    const lock = this.options.createLock?.(sessionId) ?? new SessionBrowserLock(sessionId);
    let acquired: boolean;
    try {
      acquired = await lock.acquire();
    } catch {
      return deleteResult(sessionId, 'lock_unavailable', null);
    }
    if (!acquired) return deleteResult(sessionId, 'lock_unavailable', null);
    try {
      let initial: LocalArchiveInspection;
      try {
        initial = await this.store.inspectLocalArchive(sessionId);
      } catch {
        return deleteResult(sessionId, 'transaction_aborted', null);
      }
      if (initial.activeOrDirty) {
        return deleteResult(sessionId, 'blocked_active_or_dirty', null);
      }
      if (initial.pendingDeliveryCount > 0) {
        return deleteResult(sessionId, 'blocked_pending_delivery', null);
      }
      if (initial.archive.length === 0 && initial.receipt !== null) {
        return deleteResult(sessionId, 'already_deleted', initial.receipt.deleted_at);
      }

      const verified = await this.verify(sessionId, initial);
      if (
        !verified.serverManifestVerified ||
        !verified.localComplete ||
        verified.session?.status === 'failed' ||
        (verified.session?.status !== 'processing' && verified.session?.status !== 'completed')
      ) {
        return deleteResult(sessionId, 'blocked_server_unverified', null);
      }
      try {
        const committed = await this.store.deleteLocalArchive(
          sessionId,
          verified.archive,
          (this.options.now?.() ?? new Date()).toISOString(),
        );
        return deleteResult(sessionId, committed.result, committed.receipt.deleted_at);
      } catch {
        return deleteResult(sessionId, 'transaction_aborted', null);
      }
    } finally {
      await lock.release();
    }
  }

  private async verify(
    sessionId: string,
    knownInspection?: LocalArchiveInspection,
  ): Promise<VerifiedArchive> {
    let inspection: LocalArchiveInspection;
    try {
      inspection = knownInspection ?? (await this.store.inspectLocalArchive(sessionId));
    } catch {
      return emptyVerification();
    }
    if (
      inspection.archive.length === 0 ||
      inspection.activeOrDirty ||
      inspection.pendingDeliveryCount > 0
    ) {
      return {
        archive: inspection.archive,
        inspection,
        localComplete: false,
        serverManifestVerified: false,
        session: null,
      };
    }

    try {
      const session = await this.api.getSession(sessionId);
      const finalization = session.finalization;
      if (
        session.id !== sessionId ||
        finalization === null ||
        finalization === undefined ||
        finalization.upload_status !== 'complete' ||
        finalization.manifest_checksum === null ||
        !Object.hasOwn(finalization, 'total_size_bytes') ||
        !isSafeNonNegativeInteger(finalization.total_size_bytes) ||
        session.capture?.status !== 'stopped' ||
        !['processing', 'completed', 'failed'].includes(session.status)
      ) {
        return unverified(inspection, session);
      }
      const manifest = await this.api.getAudioManifest(finalization.audio_object_id);
      const serverManifestVerified = verifyServerManifest(sessionId, session, manifest);
      if (!serverManifestVerified) return unverified(inspection, session);

      const local = await verifyLocalArchive(
        inspection.archive,
        manifest.chunks,
        this.options.crypto ?? globalThis.crypto,
      );
      return {
        archive: inspection.archive,
        inspection,
        localComplete: local === 'complete',
        serverManifestVerified: local !== 'corrupt',
        session,
      };
    } catch {
      return unverified(inspection, null);
    }
  }

  private toProjection(
    sessionId: string,
    verified: VerifiedArchive,
    originStorage: LocalAudioArchiveProjection['origin_storage'],
  ): LocalAudioArchiveProjection {
    const { inspection } = verified;
    const archiveBytes = inspection.archive.reduce((total, chunk) => total + chunk.byteLength, 0);
    let state: LocalArchiveState;
    if (inspection.activeOrDirty) state = 'blocked_active_or_dirty';
    else if (inspection.pendingDeliveryCount > 0) state = 'blocked_pending_delivery';
    else if (inspection.archive.length > 0 && !verified.serverManifestVerified)
      state = 'blocked_server_unverified';
    else if (inspection.archive.length === 0)
      state = inspection.receipt === null ? 'missing_unknown' : 'deleted_on_device';
    else state = verified.localComplete ? 'available_complete' : 'available_incomplete';

    return {
      archive_bytes: archiveBytes,
      archive_chunk_count: inspection.archive.length,
      contract_version: CONTRACT_VERSION,
      kind: 'projection',
      origin_storage: originStorage,
      pending_delivery_count: inspection.pendingDeliveryCount,
      playback_available: state === 'available_complete',
      server_audio_retained: true,
      session_id: sessionId,
      state,
      state_basis: {
        active_or_dirty: inspection.activeOrDirty,
        deletion_receipt_present: inspection.receipt !== null,
        local_archive_complete: verified.localComplete,
        server_manifest_verified: verified.serverManifestVerified,
      },
    };
  }

  private async storageEstimate(): Promise<LocalAudioArchiveProjection['origin_storage']> {
    const empty = {
      accuracy: 'origin_wide_approximate' as const,
      available_bytes: null,
      quota_bytes: null,
      usage_bytes: null,
    };
    try {
      const storage = this.options.storage === undefined ? navigator.storage : this.options.storage;
      if (storage === null || storage.estimate === undefined) return empty;
      const estimate = await storage.estimate();
      const usage = safeEstimate(estimate.usage);
      const quota = safeEstimate(estimate.quota);
      return {
        accuracy: 'origin_wide_approximate',
        available_bytes: usage === null || quota === null ? null : Math.max(0, quota - usage),
        quota_bytes: quota,
        usage_bytes: usage,
      };
    } catch {
      return empty;
    }
  }
}

function verifyServerManifest(
  sessionId: string,
  session: InterviewSessionResponse,
  manifest: AudioManifestResponse,
): boolean {
  const finalization = session.finalization;
  if (finalization === null || finalization === undefined) return false;
  if (
    manifest.id !== finalization.audio_object_id ||
    manifest.session_id !== sessionId ||
    manifest.project_id !== session.project_id ||
    manifest.purpose !== 'interview' ||
    manifest.status !== 'complete' ||
    manifest.completed_at === null ||
    manifest.manifest_checksum === null ||
    manifest.manifest_checksum !== finalization.manifest_checksum ||
    !isSafeNonNegativeInteger(manifest.chunk_count) ||
    !isSafeNonNegativeInteger(manifest.total_size_bytes) ||
    !isSafeNonNegativeInteger(finalization.total_size_bytes) ||
    manifest.chunk_count !== finalization.expected_chunk_count ||
    manifest.chunk_count !== manifest.chunks.length ||
    manifest.total_size_bytes !== finalization.total_size_bytes
  ) {
    return false;
  }
  let total = 0;
  for (const [index, chunk] of manifest.chunks.entries()) {
    if (
      chunk.sequence_no !== index ||
      !isSafeNonNegativeInteger(chunk.size_bytes) ||
      !isSafeNonNegativeInteger(chunk.start_ms) ||
      !isSafeNonNegativeInteger(chunk.end_ms) ||
      chunk.end_ms <= chunk.start_ms ||
      chunk.checksum.length === 0 ||
      chunk.mime_type.length === 0
    ) {
      return false;
    }
    total += chunk.size_bytes;
    if (!Number.isSafeInteger(total)) return false;
  }
  return total === manifest.total_size_bytes;
}

async function verifyLocalArchive(
  archive: readonly ImmutableAudioChunk[],
  manifest: readonly AudioManifestChunk[],
  crypto: Crypto,
): Promise<'complete' | 'corrupt' | 'incomplete'> {
  if (archive.length !== manifest.length) return 'incomplete';
  for (const [index, local] of archive.entries()) {
    const remote = manifest[index];
    if (
      remote === undefined ||
      local.sequenceNo !== index ||
      local.key !== `${local.sessionId}:${String(index)}` ||
      local.byteLength !== remote.size_bytes ||
      local.blob.size !== remote.size_bytes ||
      local.checksumSha256 !== remote.checksum ||
      local.mimeType !== remote.mime_type ||
      local.blob.type !== remote.mime_type ||
      local.startedAtMs !== remote.start_ms ||
      local.endedAtMs !== remote.end_ms
    ) {
      return 'corrupt';
    }
    try {
      const actual = await sha256(local.blob, crypto);
      if (actual !== remote.checksum) return 'corrupt';
    } catch {
      return 'incomplete';
    }
  }
  return 'complete';
}

async function sha256(blob: Blob, crypto: Crypto): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safeEstimate(value: unknown): number | null {
  return isSafeNonNegativeInteger(value) ? value : null;
}

function emptyVerification(): VerifiedArchive {
  return {
    archive: [],
    inspection: { activeOrDirty: false, archive: [], pendingDeliveryCount: 0, receipt: null },
    localComplete: false,
    serverManifestVerified: false,
    session: null,
  };
}

function unverified(
  inspection: LocalArchiveInspection,
  session: InterviewSessionResponse | null,
): VerifiedArchive {
  return {
    archive: inspection.archive,
    inspection,
    localComplete: false,
    serverManifestVerified: false,
    session,
  };
}

function deleteResult(
  sessionId: string,
  result: LocalDeleteResultCode,
  deletedAt: string | null,
): LocalAudioDeleteResult {
  return {
    contract_version: CONTRACT_VERSION,
    deleted_at: deletedAt,
    kind: 'delete_result',
    result,
    server_audio_retained: true,
    server_memory_retained: true,
    server_transcript_retained: true,
    session_id: sessionId,
  };
}
