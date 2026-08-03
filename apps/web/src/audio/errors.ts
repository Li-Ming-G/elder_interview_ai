export type AudioCaptureErrorCode =
  | 'AUDIO_BUFFER_CAPACITY_EXCEEDED'
  | 'AUDIO_BUFFER_CONFLICT'
  | 'AUDIO_BUFFER_WRITE_FAILED'
  | 'AUDIO_CAPTURE_UNSUPPORTED'
  | 'AUDIO_DEVICE_UNAVAILABLE'
  | 'AUDIO_PERMISSION_DENIED'
  | 'RECORDING_NOT_ALLOWED'
  | 'RECORDING_SESSION_REQUIRED';

export class AudioCaptureError extends Error {
  public constructor(
    public readonly code: AudioCaptureErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AudioCaptureError';
  }
}

export class AudioBufferConflictError extends AudioCaptureError {
  public constructor() {
    super('AUDIO_BUFFER_CONFLICT', '同一会话和序号已经存在不同的原始音频分片');
    this.name = 'AudioBufferConflictError';
  }
}

export class AudioBufferCapacityError extends AudioCaptureError {
  public constructor() {
    super('AUDIO_BUFFER_CAPACITY_EXCEEDED', '本地可靠暂存空间已达到安全上限');
    this.name = 'AudioBufferCapacityError';
  }
}

export class AudioBufferWriteError extends AudioCaptureError {
  public constructor(cause?: unknown) {
    super('AUDIO_BUFFER_WRITE_FAILED', '原始音频分片未能写入本地可靠暂存', { cause });
    this.name = 'AudioBufferWriteError';
  }
}
