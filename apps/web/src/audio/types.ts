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

export interface AudioUploadJob {
  audioObjectId: string | null;
  bufferSessionId: string;
  chunkRequestIds: Record<string, string>;
  completeRequestId: string | null;
  createRequestId: string;
  expectedChunkCount: number | null;
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
