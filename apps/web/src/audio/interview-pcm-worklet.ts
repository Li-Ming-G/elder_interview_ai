declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  public readonly port: MessagePort;
  public constructor(options?: AudioWorkletNodeOptions);
  public abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

const OUTPUT_SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 1_600;
const FRAME_BYTES = FRAME_SAMPLES * 2;

class InterviewPcmProcessor extends AudioWorkletProcessor {
  private frameBuffer = new ArrayBuffer(FRAME_BYTES);
  private frameView = new DataView(this.frameBuffer);
  private frameOffset = 0;
  private readonly pendingSamples: number[] = [];
  private sourcePosition = 0;
  private readonly sourceSamplesPerOutput = sampleRate / OUTPUT_SAMPLE_RATE;

  public process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    if (channels === undefined || first === undefined) return true;

    for (let index = 0; index < first.length; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] ?? 0;
      this.pendingSamples.push(sample / channels.length);
    }

    while (this.sourcePosition + 1 < this.pendingSamples.length) {
      const lowerIndex = Math.floor(this.sourcePosition);
      const fraction = this.sourcePosition - lowerIndex;
      const lower = this.pendingSamples[lowerIndex] ?? 0;
      const upper = this.pendingSamples[lowerIndex + 1] ?? lower;
      this.writeSample(lower + (upper - lower) * fraction);
      this.sourcePosition += this.sourceSamplesPerOutput;
    }

    const consumed = Math.floor(this.sourcePosition);
    if (consumed > 0) {
      this.pendingSamples.splice(0, consumed);
      this.sourcePosition -= consumed;
    }
    return true;
  }

  private writeSample(value: number): void {
    const clamped = Math.max(-1, Math.min(1, value));
    const signed = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    this.frameView.setInt16(this.frameOffset * 2, signed, true);
    this.frameOffset += 1;
    if (this.frameOffset !== FRAME_SAMPLES) return;

    const completed = this.frameBuffer;
    this.frameBuffer = new ArrayBuffer(FRAME_BYTES);
    this.frameView = new DataView(this.frameBuffer);
    this.frameOffset = 0;
    this.port.postMessage({ pcm: completed, type: 'pcm-frame' }, [completed]);
  }
}

registerProcessor('interview-pcm-processor', InterviewPcmProcessor);
