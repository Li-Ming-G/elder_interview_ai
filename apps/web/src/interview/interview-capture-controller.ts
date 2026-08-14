import type {
  AudioChunkResponse,
  AudioManifestResponse,
  CaptureInterruptionReason,
  InterviewSessionResponse,
  SessionCaptureSnapshot,
  SessionChunkCommitment,
} from '@elder-interview/contracts';

import type { AudioChunkQueue } from '../audio/audio-chunk-queue.js';
import type {
  BrowserStorageAssessment,
  BrowserStorageGuard,
} from '../audio/browser-storage-guard.js';
import type { BrowserCaptureFailureReason } from '../audio/browser-capture-core.js';
import type { SequentialAudioDeliveryPump } from '../audio/sequential-delivery-pump.js';
import type { SessionBrowserLock } from '../audio/session-browser-lock.js';
import type {
  AudioArchiveSnapshot,
  AudioUploadJob,
  AudioUploadJobStore,
  BrowserCaptureCheckpointStore,
  CaptureInterruptionReportRecord,
  CaptureInterruptionReportStore,
  ImmutableAudioChunk,
  InterviewCaptureJobState,
} from '../audio/types.js';
import type { RealtimeState } from '../realtime-transcription/realtime-transport.js';
import { InterviewApiError, type InterviewApi, type InterviewCaptureApi } from './interview-api.js';

const INITIAL_REALTIME_STATE: RealtimeState = {
  calibration: null,
  connection: 'closed',
  errorCode: null,
  failureKind: null,
  finals: [],
  interim: null,
  pendingBytes: 0,
  pendingFrames: 0,
  resetRequired: false,
  resumed: false,
};

export type InterviewCaptureControllerPhase =
  'idle' | 'preparing' | 'active' | 'interrupted' | 'stopping' | 'stopped' | 'locked' | 'failed';

type CaptureAttemptLockOwner = 'controller' | 'runtime';

export interface InterviewCaptureControllerSnapshot {
  archive: AudioArchiveSnapshot;
  audioObjectId: string | null;
  audioStreamId: string | null;
  checkpointDirty: boolean;
  deliveryError: string | null;
  generationNo: number | null;
  lastError: string | null;
  localJobId: string;
  endHandoff: PersistedEndHandoffSnapshot | null;
  phase: InterviewCaptureControllerPhase;
  projectId: string;
  realtime: RealtimeState;
  serverCapture: SessionCaptureSnapshot | null;
  serverSession: InterviewSessionResponse | null;
  serverVerificationError: string | null;
  serverVerifiedAt: string | null;
  sessionId: string;
  storage: BrowserStorageAssessment | null;
}

export interface PersistedEndHandoffSnapshot {
  audioObjectId: string;
  completeRequestId: string;
  expectedChunkCount: number;
  stopRequestId: string;
}

export interface CaptureStopHandoff {
  audioObjectId: string;
  audioStreamId: string;
  chunks: readonly SessionChunkCommitment[];
  completeRequestId: string;
  expectedChunkCount: number;
  generationNo: number;
  localJobId: string;
  projectId: string;
  sessionId: string;
  snapshot: InterviewCaptureControllerSnapshot;
  stopRequestId: string;
}

export interface InterviewCaptureRuntime {
  activateRealtime(): Promise<void>;
  interrupt(): Promise<void>;
  start(stream: MediaStream): Promise<void>;
  stop(): Promise<ImmutableAudioChunk[]>;
}

export interface InterviewCaptureRuntimeFactoryInput {
  audioStreamId: string;
  generationNo: number;
  mimeType: string;
  onArchiveProgress(): void;
  onCaptureFailure(reason: BrowserCaptureFailureReason, error?: unknown): void;
  onRealtimeState(state: RealtimeState): void;
}

export type InterviewCaptureRuntimeFactory = (
  input: InterviewCaptureRuntimeFactoryInput,
) => InterviewCaptureRuntime;

export interface InterviewCaptureControllerOptions {
  api: InterviewApi & InterviewCaptureApi;
  browserLock: SessionBrowserLock;
  checkpointStore: BrowserCaptureCheckpointStore;
  createRuntime: InterviewCaptureRuntimeFactory;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  interruptionReports: CaptureInterruptionReportStore;
  jobs: AudioUploadJobStore;
  mimeType: () => string;
  projectId: string;
  pump: SequentialAudioDeliveryPump;
  queue: AudioChunkQueue;
  requestId?: () => string;
  sessionId: string;
  storageGuard: BrowserStorageGuard;
}

const EMPTY_ARCHIVE: AudioArchiveSnapshot = {
  archiveByteLength: 0,
  archiveChunkCount: 0,
  archiveHighWaterSequenceNo: -1,
  deliveryAcknowledgedHighWaterSequenceNo: -1,
  pendingDeliveryCount: 0,
  timelineEndMs: 0,
};

export class InterviewCaptureController {
  private readonly listeners = new Set<(snapshot: InterviewCaptureControllerSnapshot) => void>();
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly requestId: () => string;
  private operation: Promise<unknown> = Promise.resolve();
  private runtime: InterviewCaptureRuntime | null = null;
  private runtimeGenerationKey: string | null = null;
  private realtimeActivated = false;
  private state: InterviewCaptureControllerSnapshot;

  public constructor(private readonly options: InterviewCaptureControllerOptions) {
    for (const value of [options.projectId, options.sessionId]) {
      if (value.trim().length === 0) throw new TypeError('capture controller identity is required');
    }
    const mediaDevices = globalThis.navigator.mediaDevices;
    this.getUserMedia =
      options.getUserMedia ??
      ((constraints): Promise<MediaStream> => mediaDevices.getUserMedia(constraints));
    this.requestId = options.requestId ?? ((): string => globalThis.crypto.randomUUID());
    this.state = {
      archive: EMPTY_ARCHIVE,
      audioObjectId: null,
      audioStreamId: null,
      checkpointDirty: false,
      deliveryError: null,
      generationNo: null,
      lastError: null,
      localJobId: interviewCaptureLocalJobId(options.sessionId),
      endHandoff: null,
      phase: 'idle',
      projectId: options.projectId,
      realtime: INITIAL_REALTIME_STATE,
      serverCapture: null,
      serverSession: null,
      serverVerificationError: null,
      serverVerifiedAt: null,
      sessionId: options.sessionId,
      storage: null,
    };
  }

  public get snapshot(): InterviewCaptureControllerSnapshot {
    return cloneSnapshot(this.state);
  }

  public subscribe(listener: (snapshot: InterviewCaptureControllerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  public start(recordingReminderVersion: string): Promise<InterviewCaptureControllerSnapshot> {
    if (recordingReminderVersion !== 'recording-reminder-v1') {
      return Promise.reject(new Error('RECORDING_REMINDER_UNAVAILABLE'));
    }
    return this.serial(() => this.startInternal(recordingReminderVersion));
  }

  public recover(
    serverSession?: InterviewSessionResponse,
  ): Promise<InterviewCaptureControllerSnapshot> {
    return this.serial(() => this.recoverInternal(serverSession));
  }

  public resume(): Promise<InterviewCaptureControllerSnapshot> {
    return this.serial(() => this.resumeInternal());
  }

  public verifyServerSession(): Promise<InterviewCaptureControllerSnapshot> {
    return this.serial(async () => {
      try {
        const session = await this.options.api.getSession(this.options.sessionId);
        this.observeServerSession(session);
        if (
          this.runtime !== null &&
          session.status !== 'recording' &&
          session.status !== 'reconnecting'
        ) {
          const runtime = this.runtime;
          this.runtime = null;
          this.runtimeGenerationKey = null;
          this.realtimeActivated = false;
          await runtime.interrupt().catch((error: unknown) => {
            this.patch({ lastError: errorCode(error) });
          });
          await this.options.browserLock.release().catch(() => undefined);
          await this.refreshArchiveAndDeliver(true).catch(() => undefined);
        }
        return this.snapshot;
      } catch (error) {
        if (isAuthorityFailure(error)) {
          const job = await this.formalJobForCleanup(null);
          if (job === null) {
            const runtime = this.runtime;
            this.runtime = null;
            this.runtimeGenerationKey = null;
            this.realtimeActivated = false;
            await runtime?.interrupt().catch(() => undefined);
            await this.options.browserLock.release().catch(() => undefined);
          } else {
            await this.interruptForAuthorityLoss(job, error).catch(() => undefined);
          }
          await this.refreshArchiveAndDeliver(false).catch(() => undefined);
          this.patch({ lastError: 'AUTHORITY_LOST', phase: 'interrupted' });
        }
        this.patch({ serverVerificationError: errorCode(error) });
        throw error;
      }
    });
  }

  public observeServerSession(
    session: InterviewSessionResponse,
  ): InterviewCaptureControllerSnapshot {
    assertSessionIdentity(session, this.options.projectId, this.options.sessionId);
    this.patch({
      phase: phaseFromFacts(session, this.state.endHandoff, this.state.phase),
      serverCapture: session.capture ?? null,
      serverSession: session,
      serverVerificationError: null,
      serverVerifiedAt: new Date().toISOString(),
    });
    return this.snapshot;
  }

  public flushDelivery(): Promise<number> {
    return this.serial(async () => {
      try {
        return await this.flushDeliveryInternal();
      } catch (error) {
        this.observeDeliveryFailure(error);
        throw error;
      }
    });
  }

  public stopAndFreeze(): Promise<CaptureStopHandoff> {
    return this.serial(() => this.stopAndFreezeInternal());
  }

  public completeFrozenAudio(
    handoff: CaptureStopHandoff,
  ): Promise<InterviewCaptureControllerSnapshot> {
    return this.serial(() => this.completeFrozenAudioInternal(handoff));
  }

  private async startInternal(
    recordingReminderVersion: 'recording-reminder-v1',
  ): Promise<InterviewCaptureControllerSnapshot> {
    if (!(await this.options.browserLock.acquire())) {
      this.patch({ phase: 'locked', lastError: 'BROWSER_CAPTURE_LOCKED' });
      throw new Error('BROWSER_CAPTURE_LOCKED');
    }

    let job: AudioUploadJob | null = null;
    let lockOwner: CaptureAttemptLockOwner = 'controller';
    let stream: MediaStream | null = null;
    let serverBoundThisAttempt = false;
    let runtimeStarted = false;
    try {
      job = await this.options.jobs.getUploadJob(this.state.localJobId);
      if (job !== null) this.assertFormalJob(job);
      if (job !== null && this.runtime !== null) {
        lockOwner = 'runtime';
        const existingCapture = requiredCapture(job);
        if (existingCapture.status === 'active') return this.snapshot;
        if (
          existingCapture.status === 'recording' ||
          existingCapture.status === 'server_preparing'
        ) {
          await this.confirmAndActivate(job);
          return this.snapshot;
        }
      }
      if (job !== null) {
        const existingCapture = requiredCapture(job);
        if (existingCapture.generationNo !== null || existingCapture.status !== 'prepared') {
          throw new Error('CAPTURE_RECOVERY_REQUIRED');
        }
      }
      const storage = await this.options.storageGuard.assertCanStart();
      this.patch({ phase: 'preparing', storage, lastError: null });
      job ??= await this.loadOrCreateFormalJob();
      const capture = requiredCapture(job);
      stream = await this.getUserMedia({ audio: true, video: false });
      const started = await this.options.api.startSession(this.options.sessionId, {
        audio_stream_id: capture.audioStreamId,
        mime_type: job.mimeType,
        recording_reminder_version: recordingReminderVersion,
        request_id: capture.startRequestId,
      });
      assertSessionIdentity(started, this.options.projectId, this.options.sessionId);
      this.observeServerSession(started);
      const serverCapture = requiredMatchingCapture(started, {
        audioObjectId: null,
        audioStreamId: capture.audioStreamId,
        generationNo: 0,
        statuses: ['preparing', 'active'],
      });
      job = await this.bindServerCapture(job, serverCapture, 'server_preparing');
      serverBoundThisAttempt = true;
      await this.startRuntime(job, stream);
      runtimeStarted = true;
      lockOwner = 'runtime';
      stream = null;
      await this.confirmAndActivate(job);
      return this.snapshot;
    } catch (error) {
      stopStreamWithoutThrowing(stream);
      if (serverBoundThisAttempt && !runtimeStarted) {
        const runtime = this.runtime;
        this.runtime = null;
        this.runtimeGenerationKey = null;
        this.realtimeActivated = false;
        await runtime?.interrupt().catch(() => undefined);
        if (lockOwner === 'controller') {
          await this.options.browserLock.release().catch(() => undefined);
        }
        if (job !== null) {
          await this.reportInterrupted(job, 'capture_start_failed', error).catch(() => undefined);
        }
        this.patch({ phase: 'interrupted', lastError: errorCode(error) });
      } else if (this.runtime === null) {
        if (lockOwner === 'controller') {
          await this.options.browserLock.release().catch(() => undefined);
        }
        this.patch({ phase: 'failed', lastError: errorCode(error) });
      } else if (isAuthorityFailure(error)) {
        const latest = await this.formalJobForCleanup(job);
        if (latest === null) {
          const runtime = this.runtime;
          this.runtime = null;
          this.runtimeGenerationKey = null;
          this.realtimeActivated = false;
          await runtime.interrupt().catch(() => undefined);
          await this.options.browserLock.release().catch(() => undefined);
        } else {
          await this.interruptForAuthorityLoss(latest, error).catch(() => undefined);
          await this.options.browserLock.release().catch(() => undefined);
        }
        this.patch({ lastError: errorCode(error) });
      } else {
        this.patch({ lastError: errorCode(error) });
      }
      throw error;
    }
  }

  private async recoverInternal(
    suppliedSession?: InterviewSessionResponse,
  ): Promise<InterviewCaptureControllerSnapshot> {
    const session = suppliedSession ?? (await this.options.api.getSession(this.options.sessionId));
    this.observeServerSession(session);
    const job = await this.options.jobs.getUploadJob(this.state.localJobId);
    const archive = await this.options.queue.getArchiveSnapshot(this.options.sessionId);
    const endHandoff = job === null ? null : persistedEndHandoff(job);
    this.patch({ archive, endHandoff, serverCapture: session.capture ?? null, lastError: null });
    if (this.runtime !== null) return this.snapshot;
    if (job === null || job.interviewCapture === undefined) {
      if (session.capture?.status === 'preparing' || session.capture?.status === 'active') {
        await this.recoverMissingLocalJob();
      } else {
        this.patch({
          lastError: session.capture === null ? null : 'LOCAL_CAPTURE_JOB_MISSING',
          phase: phaseFromFacts(session, endHandoff, this.state.phase),
        });
      }
      return this.snapshot;
    }
    this.assertFormalJob(job);
    const checkpoint = await this.options.checkpointStore.getCaptureCheckpoint(job.jobId);
    this.patch({ checkpointDirty: checkpoint?.dirty === true });
    const serverNeedsRecovery =
      session.capture?.status === 'preparing' || session.capture?.status === 'active';
    if (!serverNeedsRecovery) {
      this.patch({ phase: phaseFromFacts(session, endHandoff, this.state.phase) });
      return this.snapshot;
    }
    if (!(await this.options.browserLock.acquire())) {
      this.patch({ phase: 'locked', lastError: 'BROWSER_CAPTURE_LOCKED' });
      return this.snapshot;
    }
    try {
      const serverCapture = session.capture;
      if (serverCapture === null || serverCapture === undefined) {
        throw new Error('SERVER_CAPTURE_SNAPSHOT_MISSING');
      }
      const rebound = await this.bindServerCapture(job, serverCapture, 'recording');
      await this.reportInterrupted(rebound, 'page_recovery_detected');
    } finally {
      await this.options.browserLock.release().catch(() => undefined);
    }
    return this.snapshot;
  }

  private async recoverMissingLocalJob(): Promise<void> {
    if (!(await this.options.browserLock.acquire())) {
      this.patch({ phase: 'locked', lastError: 'BROWSER_CAPTURE_LOCKED' });
      return;
    }
    try {
      const current = await this.options.api.getSession(this.options.sessionId);
      this.observeServerSession(current);
      const capture = current.capture;
      this.patch({ serverCapture: capture ?? null });
      if (capture?.status !== 'preparing' && capture?.status !== 'active') {
        this.patch({
          lastError: capture === null ? null : 'LOCAL_CAPTURE_JOB_MISSING',
          phase: phaseFromServerCapture(capture ?? null),
        });
        return;
      }
      let record: CaptureInterruptionReportRecord;
      try {
        record = await this.getOrCreateMissingJobReport(capture);
      } catch (error) {
        this.patch({ phase: 'failed', lastError: errorCode(error) });
        throw error;
      }
      this.patch({
        audioObjectId: capture.audio_object_id,
        audioStreamId: capture.audio_stream_id,
        generationNo: capture.generation_no,
        lastError: 'LOCAL_CAPTURE_JOB_MISSING',
        phase: 'interrupted',
      });
      try {
        const interrupted = await this.options.api.reportCaptureInterrupted(
          this.options.sessionId,
          {
            audio_stream_id: record.audioStreamId,
            generation_no: record.generationNo,
            reason: record.reason,
            request_id: record.requestId,
          },
        );
        this.observeServerSession(interrupted);
        const serverCapture = requiredMatchingCapture(interrupted, {
          audioObjectId: record.audioObjectId,
          audioStreamId: record.audioStreamId,
          generationNo: record.generationNo,
          statuses: ['interrupted'],
        });
        this.patch({ serverCapture });
        const updatedAt = new Date().toISOString();
        await this.options.interruptionReports.updateCaptureInterruptionReport(
          record.jobId,
          (persisted) => ({
            ...persisted,
            lastError: null,
            status: 'acknowledged',
            updatedAt,
          }),
        );
      } catch (error) {
        const updatedAt = new Date().toISOString();
        await this.options.interruptionReports
          .updateCaptureInterruptionReport(record.jobId, (persisted) => ({
            ...persisted,
            lastError: errorCode(error),
            status: 'pending',
            updatedAt,
          }))
          .catch(() => undefined);
        this.patch({ lastError: 'LOCAL_CAPTURE_JOB_MISSING', phase: 'interrupted' });
        throw error;
      }
    } finally {
      await this.options.browserLock.release().catch(() => undefined);
    }
  }

  private async getOrCreateMissingJobReport(
    capture: SessionCaptureSnapshot,
  ): Promise<CaptureInterruptionReportRecord> {
    const jobId = captureInterruptionReportJobId(
      this.options.sessionId,
      capture.generation_no,
      capture.audio_stream_id,
    );
    const now = new Date().toISOString();
    return this.options.interruptionReports.getOrCreateCaptureInterruptionReport({
      audioObjectId: capture.audio_object_id,
      audioStreamId: capture.audio_stream_id,
      createdAt: now,
      generationNo: capture.generation_no,
      jobId,
      lastError: null,
      projectId: this.options.projectId,
      reason: 'page_recovery_detected',
      recordType: 'capture-interruption-report-v1',
      requestId: this.requestId(),
      sessionId: this.options.sessionId,
      status: 'pending',
      updatedAt: now,
    });
  }

  private async resumeInternal(): Promise<InterviewCaptureControllerSnapshot> {
    let job = await this.requiredJob();
    if (persistedEndHandoff(job) !== null) throw new Error('END_HANDOFF_ALREADY_FROZEN');
    const capture = requiredCapture(job);
    if (this.runtime !== null && capture.generationNo !== null) {
      if (capture.status === 'active') return this.snapshot;
      if (capture.status === 'recording' || capture.status === 'server_preparing') {
        await this.confirmAndActivate(job);
        return this.snapshot;
      }
    }
    const server = await this.options.api.getSession(this.options.sessionId);
    assertSessionIdentity(server, this.options.projectId, this.options.sessionId);
    if (server.capture?.status !== 'interrupted') throw new Error('CAPTURE_NOT_INTERRUPTED');
    if (capture.audioObjectId !== server.capture.audio_object_id) {
      throw new Error('CAPTURE_AUDIO_OBJECT_MISMATCH');
    }
    if (!(await this.options.browserLock.acquire())) {
      this.patch({ phase: 'locked', lastError: 'BROWSER_CAPTURE_LOCKED' });
      throw new Error('BROWSER_CAPTURE_LOCKED');
    }
    let stream: MediaStream | null = null;
    let lockOwner: CaptureAttemptLockOwner = 'controller';
    let resumeBoundThisAttempt = false;
    let runtimeStarted = false;
    try {
      const storage = await this.options.storageGuard.assertCanStart();
      const archive = await this.options.queue.getArchiveSnapshot(this.options.sessionId);
      let pending = capture.pendingResume;
      if (pending === null) {
        pending = {
          audioStreamId: this.requestId(),
          localArchiveChunkCount: archive.archiveChunkCount,
          localArchiveTimelineHighWaterMs: archive.timelineEndMs,
          requestId: this.requestId(),
        };
        job = await this.putCapture(job, { ...capture, pendingResume: pending });
      }
      this.patch({ phase: 'preparing', storage, archive, lastError: null });
      const resumed = await this.options.api.recoverSession(this.options.sessionId, {
        action: 'resume_capture',
        audio_stream_id: pending.audioStreamId,
        local_archive_chunk_count: pending.localArchiveChunkCount,
        local_archive_timeline_high_water_ms: pending.localArchiveTimelineHighWaterMs,
        request_id: pending.requestId,
      });
      this.observeServerSession(resumed);
      const serverCapture = requiredMatchingCapture(resumed, {
        audioObjectId: capture.audioObjectId,
        audioStreamId: pending.audioStreamId,
        generationNo: (capture.generationNo ?? server.capture.generation_no) + 1,
        statuses: ['preparing', 'active'],
      });
      job = await this.bindServerCapture(job, serverCapture, 'server_preparing', true);
      resumeBoundThisAttempt = true;
      stream = await this.getUserMedia({ audio: true, video: false });
      await this.startRuntime(job, stream);
      runtimeStarted = true;
      lockOwner = 'runtime';
      stream = null;
      await this.confirmAndActivate(job);
      return this.snapshot;
    } catch (error) {
      stopStreamWithoutThrowing(stream);
      if (resumeBoundThisAttempt && !runtimeStarted) {
        const runtime = this.runtime;
        this.runtime = null;
        this.runtimeGenerationKey = null;
        this.realtimeActivated = false;
        await runtime?.interrupt().catch(() => undefined);
        await this.reportInterrupted(job, 'capture_start_failed', error).catch(() => undefined);
        if (lockOwner === 'controller') {
          await this.options.browserLock.release().catch(() => undefined);
        }
        this.patch({ phase: 'interrupted', lastError: errorCode(error) });
      } else if (this.runtime === null) {
        if (lockOwner === 'controller') {
          await this.options.browserLock.release().catch(() => undefined);
        }
        this.patch({ phase: 'interrupted', lastError: errorCode(error) });
      } else if (isAuthorityFailure(error)) {
        const latest = await this.formalJobForCleanup(job);
        if (latest === null) {
          const runtime = this.runtime;
          this.runtime = null;
          this.runtimeGenerationKey = null;
          this.realtimeActivated = false;
          await runtime.interrupt().catch(() => undefined);
          await this.options.browserLock.release().catch(() => undefined);
        } else {
          await this.interruptForAuthorityLoss(latest, error).catch(() => undefined);
          await this.options.browserLock.release().catch(() => undefined);
        }
        this.patch({ lastError: errorCode(error) });
      } else {
        this.patch({ lastError: errorCode(error) });
      }
      throw error;
    }
  }

  private async startRuntime(job: AudioUploadJob, stream: MediaStream): Promise<void> {
    const capture = requiredBoundCapture(job);
    const generationKey = captureGenerationKey(capture.generationNo, capture.audioStreamId);
    const runtime = this.options.createRuntime({
      audioStreamId: capture.audioStreamId,
      generationNo: capture.generationNo,
      mimeType: job.mimeType,
      onArchiveProgress: () => {
        if (this.runtimeGenerationKey !== generationKey) return;
        const deliveryAllowed = this.state.phase !== 'preparing';
        void this.refreshArchiveAndDeliver(deliveryAllowed);
      },
      onCaptureFailure: (reason, error) => {
        if (this.runtimeGenerationKey !== generationKey) return;
        void this.serial(async () => {
          if (this.runtimeGenerationKey !== generationKey) return;
          const latest = await this.requiredJob();
          this.runtime = null;
          this.runtimeGenerationKey = null;
          this.realtimeActivated = false;
          await this.reportInterrupted(latest, reason, error);
        });
      },
      onRealtimeState: (realtime) => {
        if (this.runtimeGenerationKey !== generationKey) return;
        this.patch({ realtime });
        if (realtime.failureKind === 'auth' || realtime.failureKind === 'permission') {
          void this.serial(async () => {
            if (this.runtimeGenerationKey !== generationKey) return;
            const latest = await this.requiredJob();
            await this.interruptForAuthorityLoss(latest, realtime.errorCode ?? 'auth_lost');
          });
        }
      },
    });
    this.runtime = runtime;
    this.runtimeGenerationKey = generationKey;
    this.realtimeActivated = false;
    await runtime.start(stream);
    await this.putCapture(job, { ...capture, status: 'recording' });
    this.patch({
      audioObjectId: capture.audioObjectId,
      audioStreamId: capture.audioStreamId,
      generationNo: capture.generationNo,
      phase: 'preparing',
      serverCapture: toLocalServerCapture(capture, 'preparing'),
    });
  }

  private async confirmAndActivate(inputJob: AudioUploadJob): Promise<void> {
    let job = inputJob;
    let capture = requiredBoundCapture(job);
    const key = String(capture.generationNo);
    let command = capture.confirmActiveRequests[key];
    if (command === undefined) {
      command = {
        audioStreamId: capture.audioStreamId,
        generationNo: capture.generationNo,
        requestId: this.requestId(),
      };
      job = await this.putCapture(job, {
        ...capture,
        confirmActiveRequests: { ...capture.confirmActiveRequests, [key]: command },
      });
      capture = requiredBoundCapture(job);
    }
    const confirmed = await this.options.api.confirmCaptureActive(this.options.sessionId, {
      audio_stream_id: command.audioStreamId,
      generation_no: command.generationNo,
      request_id: command.requestId,
    });
    this.observeServerSession(confirmed);
    const serverCapture = requiredMatchingCapture(confirmed, {
      audioObjectId: capture.audioObjectId,
      audioStreamId: capture.audioStreamId,
      generationNo: capture.generationNo,
      statuses: ['active'],
    });
    await this.putCapture(job, { ...capture, status: 'active' });
    this.patch({
      audioObjectId: capture.audioObjectId,
      audioStreamId: capture.audioStreamId,
      generationNo: capture.generationNo,
      lastError: null,
      phase: 'active',
      serverCapture,
    });
    if (!this.realtimeActivated && this.runtime !== null) {
      this.realtimeActivated = true;
      try {
        await this.runtime.activateRealtime();
      } catch (error) {
        this.patch({
          realtime: {
            ...this.state.realtime,
            connection: 'unavailable',
            errorCode: errorCode(error),
            failureKind: 'internal',
          },
        });
      }
    }
    void this.refreshArchiveAndDeliver(true);
  }

  private async reportInterrupted(
    inputJob: AudioUploadJob,
    reason: CaptureInterruptionReason,
    error?: unknown,
  ): Promise<void> {
    const primaryError = error === undefined ? null : errorCode(error);
    let job = inputJob;
    let capture = requiredBoundCapture(job);
    const key = String(capture.generationNo);
    let report = capture.interruptionReports[key];
    if (report === undefined) {
      report = {
        audioStreamId: capture.audioStreamId,
        generationNo: capture.generationNo,
        reason,
        requestId: this.requestId(),
      };
      job = await this.putCapture(job, {
        ...capture,
        interruptionReports: { ...capture.interruptionReports, [key]: report },
        status: 'interrupted',
      });
      capture = requiredBoundCapture(job);
    } else if (capture.status !== 'interrupted') {
      job = await this.putCapture(job, { ...capture, status: 'interrupted' });
      capture = requiredBoundCapture(job);
    }
    this.patch({ phase: 'interrupted', lastError: primaryError });
    try {
      const interrupted = await this.options.api.reportCaptureInterrupted(this.options.sessionId, {
        audio_stream_id: report.audioStreamId,
        generation_no: report.generationNo,
        reason: report.reason,
        request_id: report.requestId,
      });
      this.observeServerSession(interrupted);
      const serverCapture = requiredMatchingCapture(interrupted, {
        audioObjectId: capture.audioObjectId,
        audioStreamId: capture.audioStreamId,
        generationNo: capture.generationNo,
        statuses: ['interrupted'],
      });
      this.patch({ serverCapture });
    } catch (reportError) {
      this.patch({ lastError: primaryError ?? errorCode(reportError) });
    }
  }

  private async interruptForAuthorityLoss(job: AudioUploadJob, error: unknown): Promise<void> {
    const runtime = this.runtime;
    this.runtime = null;
    this.runtimeGenerationKey = null;
    this.realtimeActivated = false;
    await runtime?.interrupt().catch(() => undefined);
    await this.reportInterrupted(job, 'auth_lost', error);
  }

  private async refreshArchiveAndDeliver(deliveryAllowed: boolean): Promise<void> {
    const archive = await this.options.queue.getArchiveSnapshot(this.options.sessionId);
    this.patch({ archive });
    if (!deliveryAllowed) return;
    await this.flushDeliveryInternal().catch((error: unknown) => {
      this.observeDeliveryFailure(error);
    });
  }

  private observeDeliveryFailure(error: unknown): void {
    this.patch({ deliveryError: errorCode(error) });
    if (!isAuthorityFailure(error)) return;
    void this.serial(async () => {
      if (this.runtime === null) return;
      await this.interruptForAuthorityLoss(await this.requiredJob(), error);
    });
  }

  private async flushDeliveryInternal(): Promise<number> {
    const job = await this.requiredJob();
    const capture = requiredBoundCapture(job);
    const delivered = await this.options.pump.deliverPending(
      job.jobId,
      async ({ chunk, requestId }) => {
        const ack = await this.options.api.uploadInterviewChunk(
          capture.audioObjectId,
          chunk,
          requestId,
        );
        return isExactChunkAck(capture.audioObjectId, chunk, ack);
      },
    );
    const archive = await this.options.queue.getArchiveSnapshot(this.options.sessionId);
    this.patch({ archive, deliveryError: null });
    return delivered;
  }

  private async stopAndFreezeInternal(): Promise<CaptureStopHandoff> {
    await this.requiredJob();
    this.patch({ phase: 'stopping' });
    const runtime = this.runtime;
    this.runtime = null;
    this.runtimeGenerationKey = null;
    this.realtimeActivated = false;
    if (runtime !== null) await runtime.stop();
    else await this.options.browserLock.release().catch(() => undefined);
    const chunks = await this.options.queue.restoreArchive(this.options.sessionId);
    assertContiguousArchive(chunks);
    let job = await this.requiredJob();
    let capture = requiredBoundCapture(job);
    const expectedChunkCount = chunks.length;
    const completeRequestId = job.completeRequestId ?? this.requestId();
    const stopRequestId = capture.stopRequestId ?? this.requestId();
    capture = { ...capture, status: 'stopped', stopRequestId };
    job = await this.options.jobs.updateUploadJob(job.jobId, (current) => ({
      ...current,
      audioObjectId: capture.audioObjectId,
      completeRequestId,
      expectedChunkCount,
      interviewCapture: capture,
      status: 'uploading',
    }));
    const archive = await this.options.queue.getArchiveSnapshot(this.options.sessionId);
    const endHandoff = persistedEndHandoff(job);
    this.patch({ archive, endHandoff, phase: 'stopped' });
    const commitments = chunks.map(toCommitment);
    return Object.freeze({
      audioObjectId: capture.audioObjectId,
      audioStreamId: capture.audioStreamId,
      chunks: Object.freeze(commitments.map((commitment) => Object.freeze(commitment))),
      completeRequestId,
      expectedChunkCount,
      generationNo: capture.generationNo,
      localJobId: job.jobId,
      projectId: this.options.projectId,
      sessionId: this.options.sessionId,
      snapshot: this.snapshot,
      stopRequestId,
    });
  }

  private async completeFrozenAudioInternal(
    handoff: CaptureStopHandoff,
  ): Promise<InterviewCaptureControllerSnapshot> {
    assertHandoffIdentity(
      handoff,
      this.options.projectId,
      this.options.sessionId,
      this.state.localJobId,
    );
    await this.flushDeliveryInternal();
    let job = await this.requiredJob();
    assertFrozenJobMatchesHandoff(job, handoff);
    if (job.status === 'complete') return this.snapshot;
    job = await this.options.jobs.updateUploadJob(job.jobId, (current) => {
      assertFrozenJobMatchesHandoff(current, handoff);
      return { ...current, lastError: null, status: 'completing' };
    });
    try {
      const manifest = await this.options.api.completeInterviewAudio(handoff.audioObjectId, {
        expected_chunk_count: handoff.expectedChunkCount,
        request_id: handoff.completeRequestId,
      });
      assertExactCompleteManifest(manifest, handoff, job.mimeType);
      await this.options.jobs.updateUploadJob(job.jobId, (current) => {
        assertFrozenJobMatchesHandoff(current, handoff);
        return { ...current, lastError: null, status: 'complete' };
      });
      const archive = await this.options.queue.getArchiveSnapshot(this.options.sessionId);
      this.patch({ archive, deliveryError: null, lastError: null });
      return this.snapshot;
    } catch (error) {
      await this.options.jobs
        .updateUploadJob(job.jobId, (current) => ({
          ...current,
          lastError: errorCode(error),
          status: current.status === 'complete' ? 'complete' : 'completing',
        }))
        .catch(() => undefined);
      this.patch({ lastError: errorCode(error) });
      throw error;
    }
  }

  private async loadOrCreateFormalJob(): Promise<AudioUploadJob> {
    const existing = await this.options.jobs.getUploadJob(this.state.localJobId);
    if (existing !== null) {
      this.assertFormalJob(existing);
      return existing;
    }
    const mimeType = this.options.mimeType();
    if (mimeType.trim().length === 0) throw new Error('AUDIO_CAPTURE_UNSUPPORTED');
    const capture: InterviewCaptureJobState = {
      audioObjectId: null,
      audioStreamId: this.requestId(),
      confirmActiveRequests: {},
      generationNo: null,
      interruptionReports: {},
      pendingResume: null,
      protocolVersion: 1,
      startRequestId: this.requestId(),
      status: 'prepared',
      stopRequestId: null,
      timelineOffsetMs: 0,
    };
    const job: AudioUploadJob = {
      audioObjectId: null,
      bufferSessionId: this.options.sessionId,
      chunkRequestIds: {},
      completeRequestId: null,
      createRequestId: null,
      expectedChunkCount: null,
      interviewCapture: capture,
      jobId: this.state.localJobId,
      lastError: null,
      mimeType,
      projectId: this.options.projectId,
      purpose: 'interview',
      serverSessionId: this.options.sessionId,
      status: 'recording',
    };
    await this.options.jobs.putUploadJob(job);
    this.patch({ audioStreamId: capture.audioStreamId });
    return job;
  }

  private async requiredJob(): Promise<AudioUploadJob> {
    const job = await this.options.jobs.getUploadJob(this.state.localJobId);
    if (job === null) throw new Error('INTERVIEW_CAPTURE_JOB_NOT_FOUND');
    this.assertFormalJob(job);
    return job;
  }

  private async formalJobForCleanup(
    fallback: AudioUploadJob | null,
  ): Promise<AudioUploadJob | null> {
    try {
      const current = await this.options.jobs.getUploadJob(this.state.localJobId);
      if (current === null) return fallback;
      this.assertFormalJob(current);
      return current;
    } catch {
      return fallback;
    }
  }

  private assertFormalJob(job: AudioUploadJob): void {
    if (
      job.jobId !== this.state.localJobId ||
      job.projectId !== this.options.projectId ||
      job.serverSessionId !== this.options.sessionId ||
      job.bufferSessionId !== this.options.sessionId ||
      job.purpose !== 'interview' ||
      job.interviewCapture?.protocolVersion !== 1 ||
      job.createRequestId !== null
    ) {
      throw new Error('INTERVIEW_CAPTURE_JOB_CONFLICT');
    }
  }

  private async bindServerCapture(
    job: AudioUploadJob,
    server: SessionCaptureSnapshot,
    status: InterviewCaptureJobState['status'],
    clearPendingResume = false,
  ): Promise<AudioUploadJob> {
    const capture = requiredCapture(job);
    if (capture.audioObjectId !== null && capture.audioObjectId !== server.audio_object_id) {
      throw new Error('CAPTURE_AUDIO_OBJECT_MISMATCH');
    }
    const updated: InterviewCaptureJobState = {
      ...capture,
      audioObjectId: server.audio_object_id,
      audioStreamId: server.audio_stream_id,
      generationNo: server.generation_no,
      pendingResume: clearPendingResume ? null : capture.pendingResume,
      status,
      timelineOffsetMs: server.timeline_offset_ms,
    };
    const result = await this.putCapture(job, updated);
    this.patch({
      audioObjectId: updated.audioObjectId,
      audioStreamId: updated.audioStreamId,
      generationNo: updated.generationNo,
      serverCapture: server,
    });
    return result;
  }

  private async putCapture(
    job: AudioUploadJob,
    capture: InterviewCaptureJobState,
  ): Promise<AudioUploadJob> {
    return this.options.jobs.updateUploadJob(job.jobId, (current) => {
      this.assertFormalJob(current);
      return { ...current, audioObjectId: capture.audioObjectId, interviewCapture: capture };
    });
  }

  private patch(patch: Partial<InterviewCaptureControllerSnapshot>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.catch(() => undefined);
    return next;
  }
}

export function interviewCaptureLocalJobId(sessionId: string): string {
  if (sessionId.trim().length === 0) throw new TypeError('sessionId is required');
  return `interview-capture:${sessionId}`;
}

export function captureInterruptionReportJobId(
  sessionId: string,
  generationNo: number,
  audioStreamId: string,
): string {
  if (sessionId.trim().length === 0 || audioStreamId.trim().length === 0) {
    throw new TypeError('capture interruption report identity is required');
  }
  if (!Number.isInteger(generationNo) || generationNo < 0) {
    throw new TypeError('capture interruption report generation is invalid');
  }
  return `capture-interruption-report:v1:${sessionId}:${String(generationNo)}:${audioStreamId}`;
}

function requiredCapture(job: AudioUploadJob): InterviewCaptureJobState {
  if (job.interviewCapture?.protocolVersion !== 1) throw new Error('FORMAL_CAPTURE_STATE_MISSING');
  return job.interviewCapture;
}

function requiredBoundCapture(
  job: AudioUploadJob,
): InterviewCaptureJobState & { audioObjectId: string; generationNo: number } {
  const capture = requiredCapture(job);
  if (capture.audioObjectId === null || capture.generationNo === null) {
    throw new Error('FORMAL_CAPTURE_NOT_BOUND');
  }
  return capture as InterviewCaptureJobState & { audioObjectId: string; generationNo: number };
}

function requiredMatchingCapture(
  session: InterviewSessionResponse,
  expected: {
    audioObjectId: string | null;
    audioStreamId: string;
    generationNo: number;
    statuses: readonly SessionCaptureSnapshot['status'][];
  },
): SessionCaptureSnapshot {
  const capture = session.capture;
  if (
    capture === null ||
    capture === undefined ||
    capture.audio_stream_id !== expected.audioStreamId ||
    capture.generation_no !== expected.generationNo ||
    (expected.audioObjectId !== null && capture.audio_object_id !== expected.audioObjectId) ||
    !expected.statuses.includes(capture.status)
  ) {
    throw new Error('SESSION_CAPTURE_ACK_MISMATCH');
  }
  return capture;
}

function assertSessionIdentity(
  session: InterviewSessionResponse,
  projectId: string,
  sessionId: string,
): void {
  if (session.id !== sessionId || session.project_id !== projectId) {
    throw new Error('SESSION_IDENTITY_MISMATCH');
  }
}

function toLocalServerCapture(
  capture: InterviewCaptureJobState & { audioObjectId: string; generationNo: number },
  status: SessionCaptureSnapshot['status'],
): SessionCaptureSnapshot {
  return {
    audio_object_id: capture.audioObjectId,
    audio_stream_id: capture.audioStreamId,
    generation_no: capture.generationNo,
    interrupted_at: null,
    interruption_reason: null,
    status,
    timeline_offset_ms: capture.timelineOffsetMs,
    uploaded_chunk_count: 0,
  };
}

function phaseFromServerCapture(
  capture: SessionCaptureSnapshot | null,
): InterviewCaptureControllerPhase {
  if (capture?.status === 'active') return 'active';
  if (capture?.status === 'preparing') return 'preparing';
  if (capture?.status === 'interrupted') return 'interrupted';
  if (capture?.status === 'stopped' || capture?.status === 'abandoned_empty') return 'stopped';
  return 'idle';
}

function phaseFromFacts(
  session: InterviewSessionResponse,
  endHandoff: PersistedEndHandoffSnapshot | null,
  current: InterviewCaptureControllerPhase,
): InterviewCaptureControllerPhase {
  if (endHandoff !== null) return session.status === 'failed' ? 'failed' : 'stopped';
  if (session.status === 'interrupted') return 'interrupted';
  if (
    session.status === 'stopping' ||
    session.status === 'processing' ||
    session.status === 'completed'
  ) {
    return 'stopped';
  }
  if (session.status === 'failed') {
    return session.capture_failure_code === 'NO_AUDIO_CAPTURED' ? 'stopped' : 'failed';
  }
  if (
    current === 'interrupted' &&
    (session.status === 'recording' || session.status === 'reconnecting')
  ) {
    return 'interrupted';
  }
  return phaseFromServerCapture(session.capture ?? null);
}

function persistedEndHandoff(job: AudioUploadJob): PersistedEndHandoffSnapshot | null {
  const capture = requiredCapture(job);
  if (
    capture.audioObjectId === null ||
    capture.stopRequestId === null ||
    job.completeRequestId === null ||
    job.expectedChunkCount === null
  ) {
    return null;
  }
  return {
    audioObjectId: capture.audioObjectId,
    completeRequestId: job.completeRequestId,
    expectedChunkCount: job.expectedChunkCount,
    stopRequestId: capture.stopRequestId,
  };
}

function isExactChunkAck(
  audioObjectId: string,
  chunk: ImmutableAudioChunk,
  ack: AudioChunkResponse,
): boolean {
  return (
    ack.audio_object_id === audioObjectId &&
    ack.sequence_no === chunk.sequenceNo &&
    ack.start_ms === chunk.startedAtMs &&
    ack.end_ms === chunk.endedAtMs &&
    ack.size_bytes === chunk.byteLength &&
    ack.checksum === chunk.checksumSha256 &&
    ack.mime_type === chunk.mimeType &&
    (ack as { upload_status: unknown }).upload_status === 'uploaded'
  );
}

function assertHandoffIdentity(
  handoff: CaptureStopHandoff,
  projectId: string,
  sessionId: string,
  localJobId: string,
): void {
  if (
    handoff.projectId !== projectId ||
    handoff.sessionId !== sessionId ||
    handoff.localJobId !== localJobId
  ) {
    throw new Error('CAPTURE_HANDOFF_IDENTITY_MISMATCH');
  }
}

function assertFrozenJobMatchesHandoff(job: AudioUploadJob, handoff: CaptureStopHandoff): void {
  const capture = requiredBoundCapture(job);
  if (
    job.jobId !== handoff.localJobId ||
    job.audioObjectId !== handoff.audioObjectId ||
    job.completeRequestId !== handoff.completeRequestId ||
    job.expectedChunkCount !== handoff.expectedChunkCount ||
    capture.audioObjectId !== handoff.audioObjectId ||
    capture.audioStreamId !== handoff.audioStreamId ||
    capture.generationNo !== handoff.generationNo ||
    capture.stopRequestId !== handoff.stopRequestId ||
    capture.status !== 'stopped'
  ) {
    throw new Error('CAPTURE_FROZEN_JOB_MISMATCH');
  }
}

function assertExactCompleteManifest(
  manifest: AudioManifestResponse,
  handoff: CaptureStopHandoff,
  mimeType: string,
): void {
  const totalBytes = handoff.chunks.reduce((sum, chunk) => sum + chunk.size_bytes, 0);
  const exactChunks =
    manifest.chunks.length === handoff.chunks.length &&
    manifest.chunks.every((chunk, index) => {
      const expected = handoff.chunks[index];
      return (
        expected !== undefined &&
        chunk.sequence_no === expected.sequence_no &&
        chunk.start_ms === expected.start_ms &&
        chunk.end_ms === expected.end_ms &&
        chunk.size_bytes === expected.size_bytes &&
        chunk.checksum === expected.checksum &&
        chunk.mime_type === expected.mime_type
      );
    });
  if (
    manifest.id !== handoff.audioObjectId ||
    manifest.project_id !== handoff.projectId ||
    manifest.session_id !== handoff.sessionId ||
    manifest.purpose !== 'interview' ||
    manifest.status !== 'complete' ||
    manifest.mime_type !== mimeType ||
    manifest.chunk_count !== handoff.expectedChunkCount ||
    manifest.total_size_bytes !== totalBytes ||
    manifest.manifest_checksum === null ||
    manifest.completed_at === null ||
    !exactChunks
  ) {
    throw new Error('AUDIO_COMPLETE_ACK_MISMATCH');
  }
}

function assertContiguousArchive(chunks: readonly ImmutableAudioChunk[]): void {
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.sequenceNo !== index) throw new Error('ARCHIVE_SEQUENCE_GAP');
  }
}

function toCommitment(chunk: ImmutableAudioChunk): SessionChunkCommitment {
  return {
    checksum: chunk.checksumSha256,
    end_ms: chunk.endedAtMs,
    mime_type: chunk.mimeType,
    sequence_no: chunk.sequenceNo,
    size_bytes: chunk.byteLength,
    start_ms: chunk.startedAtMs,
  };
}

function captureGenerationKey(generationNo: number, audioStreamId: string): string {
  return `${String(generationNo)}:${audioStreamId}`;
}

function stopStreamWithoutThrowing(stream: MediaStream | null): void {
  let tracks: MediaStreamTrack[];
  try {
    tracks = stream?.getTracks() ?? [];
  } catch {
    return;
  }
  for (const track of tracks) {
    try {
      track.stop();
    } catch {
      // Cleanup must not replace the capture attempt's primary failure.
    }
  }
}

function isAuthorityFailure(error: unknown): boolean {
  return (
    error instanceof InterviewApiError &&
    (error.status === 401 ||
      error.status === 403 ||
      ['AUTH_REQUIRED', 'FORBIDDEN', 'CONSENT_REQUIRED', 'SERVICE_TERM_REQUIRED'].includes(
        error.code,
      ))
  );
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'CAPTURE_FAILED';
}

function cloneSnapshot(
  snapshot: InterviewCaptureControllerSnapshot,
): InterviewCaptureControllerSnapshot {
  return {
    ...snapshot,
    archive: { ...snapshot.archive },
    endHandoff: snapshot.endHandoff === null ? null : { ...snapshot.endHandoff },
    realtime: {
      ...snapshot.realtime,
      ...(snapshot.realtime.calibration === undefined
        ? {}
        : {
            calibration:
              snapshot.realtime.calibration === null
                ? null
                : structuredClone(snapshot.realtime.calibration),
          }),
      finals: [...snapshot.realtime.finals],
    },
    serverCapture: snapshot.serverCapture === null ? null : { ...snapshot.serverCapture },
    serverSession:
      snapshot.serverSession === null
        ? null
        : {
            ...snapshot.serverSession,
            ...(snapshot.serverSession.capture === undefined
              ? {}
              : {
                  capture:
                    snapshot.serverSession.capture === null
                      ? null
                      : { ...snapshot.serverSession.capture },
                }),
            ...(snapshot.serverSession.finalization === undefined
              ? {}
              : {
                  finalization:
                    snapshot.serverSession.finalization === null
                      ? null
                      : { ...snapshot.serverSession.finalization },
                }),
          },
    storage: snapshot.storage === null ? null : { ...snapshot.storage },
  };
}
