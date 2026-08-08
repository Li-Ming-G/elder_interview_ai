export type AudioChunkDeliveryStatus = 'pending' | 'uploading' | 'failed';

export interface RecordingSessionContext {
  canRecord: boolean;
  sessionId: string;
}

export interface ImmutableAudioChunk {
  blob: Blob;
  byteLength: number;
  checksumSha256: string;
  createdAt: string;
  endedAtMs: number;
  key: string;
  mimeType: string;
  sequenceNo: number;
  sessionId: string;
  startedAtMs: number;
}

export interface AudioChunkDelivery {
  lastError: string | null;
  retryCount: number;
  status: AudioChunkDeliveryStatus;
}

export interface BufferedAudioChunk {
  chunk: ImmutableAudioChunk;
  delivery: AudioChunkDelivery;
}

export interface NewAudioChunk {
  blob: Blob;
  endedAtMs: number;
  mimeType: string;
  sequenceNo: number;
  sessionId: string;
  startedAtMs: number;
}

export interface AudioChunkStore {
  acknowledge(sessionId: string, sequenceNo: number, checksumSha256: string): Promise<boolean>;
  get(sessionId: string, sequenceNo: number): Promise<BufferedAudioChunk | null>;
  getArchive(sessionId: string, sequenceNo: number): Promise<ImmutableAudioChunk | null>;
  getArchiveSnapshot(sessionId: string): Promise<AudioArchiveSnapshot>;
  getNextSequenceNo(sessionId: string): Promise<number>;
  getTimelineEndMs(sessionId: string): Promise<number>;
  list(sessionId: string): Promise<BufferedAudioChunk[]>;
  listArchive(sessionId: string): Promise<ImmutableAudioChunk[]>;
  markFailed(sessionId: string, sequenceNo: number, errorCode: string): Promise<void>;
  markUploading(sessionId: string, sequenceNo: number): Promise<void>;
  persistImmutable(
    record: BufferedAudioChunk,
    maximumBufferedBytes: number,
  ): Promise<BufferedAudioChunk>;
  runCanary(): Promise<void>;
}

export interface AudioArchiveSnapshot {
  archiveByteLength: number;
  archiveChunkCount: number;
  archiveHighWaterSequenceNo: number;
  deliveryAcknowledgedHighWaterSequenceNo: number;
  pendingDeliveryCount: number;
  timelineEndMs: number;
}

export type AudioUploadJobStatus = 'recording' | 'uploading' | 'completing' | 'complete' | 'failed';

export type InterviewCaptureLocalStatus =
  'prepared' | 'server_preparing' | 'recording' | 'active' | 'interrupted' | 'stopped';

export interface PersistedCaptureCommand {
  audioStreamId: string;
  generationNo: number;
  requestId: string;
}

export interface PersistedCaptureInterruption extends PersistedCaptureCommand {
  reason:
    | 'capture_start_failed'
    | 'page_recovery_detected'
    | 'microphone_ended'
    | 'recorder_error'
    | 'local_archive_failed'
    | 'auth_lost'
    | 'unknown';
}

export interface PersistedCaptureResume {
  audioStreamId: string;
  localArchiveChunkCount: number;
  localArchiveTimelineHighWaterMs: number;
  requestId: string;
}

/**
 * Application-level v1 record stored inside IndexedDB's existing v4 upload-jobs store.
 * This is deliberately separate from the database schema version: adding fields to a
 * structured-clone record does not require a new object store or database migration.
 */
export interface InterviewCaptureJobState {
  audioObjectId: string | null;
  audioStreamId: string;
  confirmActiveRequests: Record<string, PersistedCaptureCommand>;
  generationNo: number | null;
  interruptionReports: Record<string, PersistedCaptureInterruption>;
  pendingResume: PersistedCaptureResume | null;
  protocolVersion: 1;
  startRequestId: string;
  status: InterviewCaptureLocalStatus;
  stopRequestId: string | null;
  timelineOffsetMs: number;
}

export interface AudioUploadJob {
  audioObjectId: string | null;
  bufferSessionId: string;
  chunkRequestIds: Record<string, string>;
  completeRequestId: string | null;
  createRequestId: string | null;
  expectedChunkCount: number | null;
  interviewCapture?: InterviewCaptureJobState;
  jobId: string;
  lastError: string | null;
  mimeType: string;
  projectId: string;
  purpose: 'consent' | 'interview';
  serverSessionId: string | null;
  status: AudioUploadJobStatus;
}

export interface AudioUploadJobStore {
  getUploadJob(jobId: string): Promise<AudioUploadJob | null>;
  putUploadJob(job: AudioUploadJob): Promise<void>;
  updateUploadJob(
    jobId: string,
    update: (current: AudioUploadJob) => AudioUploadJob,
  ): Promise<AudioUploadJob>;
}

export const CAPTURE_INTERRUPTION_REPORT_RECORD_TYPE = 'capture-interruption-report-v1' as const;

export interface CaptureInterruptionReportRecord {
  audioObjectId: string;
  audioStreamId: string;
  createdAt: string;
  generationNo: number;
  jobId: string;
  lastError: string | null;
  projectId: string;
  reason: 'page_recovery_detected';
  recordType: typeof CAPTURE_INTERRUPTION_REPORT_RECORD_TYPE;
  requestId: string;
  sessionId: string;
  status: 'acknowledged' | 'pending';
  updatedAt: string;
}

export interface CaptureInterruptionReportStore {
  getCaptureInterruptionReport(jobId: string): Promise<CaptureInterruptionReportRecord | null>;
  getOrCreateCaptureInterruptionReport(
    candidate: CaptureInterruptionReportRecord,
  ): Promise<CaptureInterruptionReportRecord>;
  updateCaptureInterruptionReport(
    jobId: string,
    update: (current: CaptureInterruptionReportRecord) => CaptureInterruptionReportRecord,
  ): Promise<CaptureInterruptionReportRecord>;
}

export function assertAudioUploadJobRecord(
  value: unknown,
  expectedJobId?: string,
): asserts value is AudioUploadJob {
  if (!isRecord(value) || 'recordType' in value) throw new Error('UPLOAD_JOB_RECORD_TYPE_MISMATCH');
  if (
    typeof value.jobId !== 'string' ||
    value.jobId.startsWith('capture-interruption-report:') ||
    (expectedJobId !== undefined && value.jobId !== expectedJobId) ||
    typeof value.projectId !== 'string' ||
    typeof value.bufferSessionId !== 'string' ||
    typeof value.mimeType !== 'string' ||
    (value.purpose !== 'consent' && value.purpose !== 'interview') ||
    !isRecord(value.chunkRequestIds)
  ) {
    throw new Error('UPLOAD_JOB_RECORD_INVALID');
  }
}

export function assertCaptureInterruptionReportRecord(
  value: unknown,
  expectedJobId?: string,
): asserts value is CaptureInterruptionReportRecord {
  if (
    !isRecord(value) ||
    value.recordType !== CAPTURE_INTERRUPTION_REPORT_RECORD_TYPE ||
    typeof value.jobId !== 'string' ||
    (expectedJobId !== undefined && value.jobId !== expectedJobId) ||
    typeof value.projectId !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.audioObjectId !== 'string' ||
    typeof value.audioStreamId !== 'string' ||
    !Number.isInteger(value.generationNo) ||
    (value.generationNo as number) < 0 ||
    value.reason !== 'page_recovery_detected' ||
    typeof value.requestId !== 'string' ||
    value.requestId.trim().length === 0 ||
    (value.status !== 'pending' && value.status !== 'acknowledged') ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (value.lastError !== null && typeof value.lastError !== 'string')
  ) {
    throw new Error('CAPTURE_INTERRUPTION_REPORT_RECORD_INVALID');
  }
  const expectedKey = `capture-interruption-report:v1:${value.sessionId}:${String(value.generationNo)}:${value.audioStreamId}`;
  if (
    value.jobId !== expectedKey ||
    value.projectId.trim().length === 0 ||
    value.sessionId.trim().length === 0 ||
    value.audioObjectId.trim().length === 0 ||
    value.audioStreamId.trim().length === 0
  ) {
    throw new Error('CAPTURE_INTERRUPTION_REPORT_RECORD_INVALID');
  }
}

export function sameCaptureInterruptionReportIdentity(
  left: CaptureInterruptionReportRecord,
  right: CaptureInterruptionReportRecord,
): boolean {
  return (
    left.jobId === right.jobId &&
    left.projectId === right.projectId &&
    left.sessionId === right.sessionId &&
    left.audioObjectId === right.audioObjectId &&
    left.audioStreamId === right.audioStreamId &&
    left.generationNo === right.generationNo &&
    left.requestId === right.requestId &&
    left.createdAt === right.createdAt
  );
}

export function sameCaptureInterruptionReportTarget(
  left: CaptureInterruptionReportRecord,
  right: CaptureInterruptionReportRecord,
): boolean {
  return (
    left.jobId === right.jobId &&
    left.projectId === right.projectId &&
    left.sessionId === right.sessionId &&
    left.audioObjectId === right.audioObjectId &&
    left.audioStreamId === right.audioStreamId &&
    left.generationNo === right.generationNo
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export type BrowserCaptureCheckpointStatus = 'failed' | 'recording' | 'starting' | 'stopped';

export interface BrowserCaptureCheckpoint {
  archiveHighWaterSequenceNo: number;
  audioStreamId: string;
  deliveryAcknowledgedHighWaterSequenceNo: number;
  dirty: boolean;
  localJobId: string;
  mimeType: string;
  sessionId: string;
  status: BrowserCaptureCheckpointStatus;
  timelineEndMs: number;
  updatedAt: string;
}

export interface BrowserCaptureCheckpointStore {
  getCaptureCheckpoint(localJobId: string): Promise<BrowserCaptureCheckpoint | null>;
  putCaptureCheckpoint(checkpoint: BrowserCaptureCheckpoint): Promise<void>;
}

export function audioChunkKey(sessionId: string, sequenceNo: number): string {
  return `${sessionId}:${sequenceNo.toString()}`;
}
