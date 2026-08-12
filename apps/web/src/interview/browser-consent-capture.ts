import { AudioChunkQueue } from '../audio/audio-chunk-queue.js';
import { AudioUploadJobRunner } from '../audio/audio-upload-job.js';
import {
  BrowserAudioRecorder,
  type AudioCaptureSnapshot,
} from '../audio/browser-audio-recorder.js';
import { IndexedDbAudioChunkStore } from '../audio/indexeddb-audio-chunk-store.js';

const MAXIMUM_CONSENT_ARCHIVE_BYTES = 64 * 1024 * 1024;
const CONSENT_TIMESLICE_MS = 1_000;
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'] as const;

export class BrowserConsentCapture {
  private readonly store = new IndexedDbAudioChunkStore();
  private readonly queue = new AudioChunkQueue(this.store, {
    maximumBufferedBytes: MAXIMUM_CONSENT_ARCHIVE_BYTES,
  });
  private readonly recorder = new BrowserAudioRecorder(this.queue, {
    supportedMimeTypes: [selectConsentMimeType()],
    timesliceMs: CONSENT_TIMESLICE_MS,
  });
  private readonly uploader = new AudioUploadJobRunner(this.queue, this.store);

  public subscribe(listener: (snapshot: AudioCaptureSnapshot) => void): () => void {
    return this.recorder.subscribe(listener);
  }

  public async start(jobId: string, projectId: string): Promise<void> {
    await this.store.runCanary();
    const job = await this.uploader.create({
      bufferSessionId: jobId,
      jobId,
      mimeType: selectConsentMimeType(),
      projectId,
      purpose: 'consent',
      serverSessionId: null,
    });
    if (job.expectedChunkCount !== null) throw new Error('CONSENT_AUDIO_ALREADY_FROZEN');
    await this.recorder.start({ canRecord: true, sessionId: jobId });
  }

  public async finishAndUpload(jobId: string, csrfToken: string): Promise<string> {
    if (this.recorder.snapshot.status === 'recording') await this.recorder.stop();
    const job = await this.store.getUploadJob(jobId);
    if (job === null) throw new Error('CONSENT_AUDIO_JOB_NOT_FOUND');
    if (job.expectedChunkCount === null) await this.uploader.freeze(jobId);
    const completed = await this.uploader.resume(jobId, csrfToken);
    if (completed.status !== 'complete' || completed.audioObjectId === null) {
      throw new Error(completed.lastError ?? 'CONSENT_AUDIO_UPLOAD_FAILED');
    }
    return completed.audioObjectId;
  }
}

export function selectConsentMimeType(): string {
  if (typeof globalThis.MediaRecorder === 'undefined') throw new Error('AUDIO_CAPTURE_UNSUPPORTED');
  const selected = MIME_TYPES.find((value) => globalThis.MediaRecorder.isTypeSupported(value));
  if (selected === undefined) throw new Error('AUDIO_CAPTURE_UNSUPPORTED');
  return selected;
}
