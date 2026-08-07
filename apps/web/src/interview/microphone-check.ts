export type MicrophoneCheckResult =
  | { inputDetected: true; permission: 'granted' }
  | { inputDetected: false; permission: 'granted' }
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
  analyser.fftSize = 1024;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));

  try {
    const inputDetected = await detectInput(analyser, samples);
    return { inputDetected, permission: 'granted' };
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
): Promise<boolean> {
  const deadline = performance.now() + 1400;
  while (performance.now() < deadline) {
    analyser.getByteTimeDomainData(samples);
    if (samples.some((sample) => Math.abs(sample - 128) >= 4)) return true;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
  }
  return false;
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
