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
  getNextSequenceNo(sessionId: string): Promise<number>;
  getTimelineEndMs(sessionId: string): Promise<number>;
  list(sessionId: string): Promise<BufferedAudioChunk[]>;
  markFailed(sessionId: string, sequenceNo: number, errorCode: string): Promise<void>;
  markUploading(sessionId: string, sequenceNo: number): Promise<void>;
  persistImmutable(
    record: BufferedAudioChunk,
    maximumBufferedBytes: number,
  ): Promise<BufferedAudioChunk>;
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

export function audioChunkKey(sessionId: string, sequenceNo: number): string {
  return `${sessionId}:${sequenceNo.toString()}`;
}
