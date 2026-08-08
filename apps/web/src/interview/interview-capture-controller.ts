import type {
  AudioChunkResponse,
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
  ImmutableAudioChunk,
  InterviewCaptureJobState,
} from '../audio/types.js';
import type { RealtimeState } from '../realtime-transcription/realtime-transport.js';
import { InterviewApiError, type InterviewApi, type InterviewCaptureApi } from './interview-api.js';

const INITIAL_REALTIME_STATE: RealtimeState = {
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

export interface InterviewCaptureControllerSnapshot {
  archive: AudioArchiveSnapshot;
  audioObjectId: string | null;
  audioStreamId: string | null;
  checkpointDirty: boolean;
  deliveryError: string | null;
  generationNo: number | null;
  lastError: string | null;
  localJobId: string;
  phase: InterviewCaptureControllerPhase;
  projectId: string;
  realtime: RealtimeState;
  serverCapture: SessionCaptureSnapshot | null;
  sessionId: string;
  storage: BrowserStorageAssessment | null;
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
      phase: 'idle',
      projectId: options.projectId,
      realtime: INITIAL_REALTIME_STATE,
      serverCapture: null,
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

  public start(): Promise<InterviewCaptureControllerSnapshot> {
    return this.serial(() => this.startInternal());
  }

  public recover(
    serverSession?: InterviewSessionResponse,
  ): Promise<InterviewCaptureControllerSnapshot> {
    return this.serial(() => this.recoverInternal(serverSession));
  }

  public resume(): Promise<InterviewCaptureControllerSnapshot> {
    return this.serial(() => this.resumeInternal());
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

  private async startInternal(): Promise<InterviewCaptureControllerSnapshot> {
    if (!(await this.options.browserLock.acquire())) {
      this.patch({ phase: 'locked', lastError: 'BROWSER_CAPTURE_LOCKED' });
      throw new Error('BROWSER_CAPTURE_LOCKED');
    }

    let stream: MediaStream | null = null;
    let serverBoundThisAttempt = false;
    let runtimeStarted = false;
    try {
      let job = await this.options.jobs.getUploadJob(this.state.localJobId);
      if (job !== null) this.assertFormalJob(job);
      if (job !== null && this.runtime !== null) {
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
        request_id: capture.startRequestId,
      });
      assertSessionIdentity(started, this.options.projectId, this.options.sessionId);
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
      stream = null;
      await this.confirmAndActivate(job);
      return this.snapshot;
    } catch (error) {
      stopStream(stream);
      const latest = await this.requiredJob();
      if (serverBoundThisAttempt && !runtimeStarted) {
        const runtime = this.runtime;
        this.runtime = null;
        this.runtimeGenerationKey = null;
        this.realtimeActivated = false;
        await runtime?.interrupt().catch(() => undefined);
        await this.reportInterrupted(latest, 'capture_start_failed', error);
      } else if (this.runtime === null) {
        await this.options.browserLock.release().catch(() => undefined);
        this.patch({ phase: 'failed', lastError: errorCode(error) });
      } else if (isAuthorityFailure(error)) {
        await this.interruptForAuthorityLoss(latest, error);
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
    assertSessionIdentity(session, this.options.projectId, this.options.sessionId);
    const job = await this.options.jobs.getUploadJob(this.state.localJobId);
    const archive = await this.options.queue.getArchiveSnapshot(this.options.sessionId);
    this.patch({ archive, serverCapture: session.capture ?? null, lastError: null });
    if (this.runtime !== null) return this.snapshot;
    if (job === null || job.interviewCapture === undefined) {
      if (session.capture?.status === 'preparing' || session.capture?.status === 'active') {
        this.patch({ phase: 'failed', lastError: 'LOCAL_CAPTURE_JOB_MISSING' });
      }
      return this.snapshot;
    }
    this.assertFormalJob(job);
    const checkpoint = await this.options.checkpointStore.getCaptureCheckpoint(job.jobId);
    this.patch({ checkpointDirty: checkpoint?.dirty === true });
    const serverNeedsRecovery =
      session.capture?.status === 'preparing' || session.capture?.status === 'active';
    if (!serverNeedsRecovery) {
      this.patch({ phase: phaseFromServerCapture(session.capture ?? null) });
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

  private async resumeInternal(): Promise<InterviewCaptureControllerSnapshot> {
    let job = await this.requiredJob();
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
      assertSessionIdentity(resumed, this.options.projectId, this.options.sessionId);
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
      stream = null;
      await this.confirmAndActivate(job);
      return this.snapshot;
    } catch (error) {
      stopStream(stream);
      const latest = await this.requiredJob();
      if (resumeBoundThisAttempt && !runtimeStarted) {
        const runtime = this.runtime;
        this.runtime = null;
        this.runtimeGenerationKey = null;
        this.realtimeActivated = false;
        await runtime?.interrupt().catch(() => undefined);
        await this.reportInterrupted(latest, 'capture_start_failed', error);
      } else if (this.runtime === null) {
        await this.options.browserLock.release().catch(() => undefined);
        this.patch({ phase: 'interrupted', lastError: errorCode(error) });
      } else if (isAuthorityFailure(error)) {
        await this.interruptForAuthorityLoss(latest, error);
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
    assertSessionIdentity(confirmed, this.options.projectId, this.options.sessionId);
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
    this.patch({ phase: 'interrupted', lastError: error === undefined ? null : errorCode(error) });
    try {
      const interrupted = await this.options.api.reportCaptureInterrupted(this.options.sessionId, {
        audio_stream_id: report.audioStreamId,
        generation_no: report.generationNo,
        reason: report.reason,
        request_id: report.requestId,
      });
      assertSessionIdentity(interrupted, this.options.projectId, this.options.sessionId);
      const serverCapture = requiredMatchingCapture(interrupted, {
        audioObjectId: capture.audioObjectId,
        audioStreamId: capture.audioStreamId,
        generationNo: capture.generationNo,
        statuses: ['interrupted'],
      });
      this.patch({ serverCapture });
    } catch (reportError) {
      this.patch({ lastError: errorCode(reportError) });
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
    this.patch({ archive, phase: 'stopped' });
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

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
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
  return error instanceof Error && error.message.length > 0 ? error.message : 'CAPTURE_FAILED';
}

function cloneSnapshot(
  snapshot: InterviewCaptureControllerSnapshot,
): InterviewCaptureControllerSnapshot {
  return {
    ...snapshot,
    archive: { ...snapshot.archive },
    realtime: { ...snapshot.realtime, finals: [...snapshot.realtime.finals] },
    serverCapture: snapshot.serverCapture === null ? null : { ...snapshot.serverCapture },
    storage: snapshot.storage === null ? null : { ...snapshot.storage },
  };
}
