export type MicrophoneCheckResult =
  | { inputDetected: true; permission: 'granted' }
  | { inputDetected: false; permission: 'granted'; reason?: 'silent' | 'too_low' }
  | { inputDetected: false; permission: 'denied' };

export type MicrophoneChecker = () => Promise<MicrophoneCheckResult>;

export async function checkMicrophoneInput(): Promise<MicrophoneCheckResult> {
  const mediaDevices = Reflect.get(navigator, 'mediaDevices') as
    Pick<MediaDevices, 'getUserMedia'> | undefined;
  if (mediaDevices === undefined) {
    return { inputDetected: false, permission: 'denied' };
  }

  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { inputDetected: false, permission: 'denied' };
    }
    throw new Error('AUDIO_DEVICE_UNAVAILABLE', { cause: error });
  }

  const AudioContextConstructor = Reflect.get(globalThis, 'AudioContext') as
    typeof AudioContext | undefined;
  if (AudioContextConstructor === undefined) {
    stopStream(stream);
    throw new Error('AUDIO_INPUT_CHECK_UNSUPPORTED');
  }

  const context = new AudioContextConstructor();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));

  try {
    const assessment = await detectInput(analyser, samples);
    return assessment === 'detected'
      ? { inputDetected: true, permission: 'granted' }
      : { inputDetected: false, permission: 'granted', reason: assessment };
  } finally {
    source.disconnect();
    analyser.disconnect();
    stopStream(stream);
    await context.close();
  }
}

async function detectInput(
  analyser: AnalyserNode,
  samples: Uint8Array<ArrayBuffer>,
): Promise<'detected' | 'silent' | 'too_low'> {
  const startedAt = performance.now();
  const baselineUntil = startedAt + 600;
  const deadline = startedAt + 3600;
  const baseline: number[] = [];
  let peak = 0;
  let consecutiveSpeechFrames = 0;
  while (performance.now() < deadline) {
    analyser.getByteTimeDomainData(samples);
    const level = rootMeanSquare(samples);
    peak = Math.max(peak, level);
    if (performance.now() < baselineUntil) {
      baseline.push(level);
    } else {
      const noiseFloor = percentile(baseline, 0.35);
      const speechThreshold = Math.max(0.005, noiseFloor * 1.8 + 0.002);
      consecutiveSpeechFrames = level >= speechThreshold ? consecutiveSpeechFrames + 1 : 0;
      if (consecutiveSpeechFrames >= 3) return 'detected';
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
  }
  return peak >= 0.003 ? 'too_low' : 'silent';
}

function rootMeanSquare(samples: Uint8Array<ArrayBuffer>): number {
  let sum = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0;
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
