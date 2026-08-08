import workletModuleUrl from './interview-pcm-worklet.ts?worker&url';

const importedWorkletModuleUrl: unknown = workletModuleUrl;

const PCM_FRAME_BYTES = 3_200;
const PROCESSOR_NAME = 'interview-pcm-processor';

interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike;
  disconnect(): void;
}

interface AudioWorkletNodeLike extends AudioNodeLike {
  readonly port: MessagePort;
}

interface AudioContextLike {
  readonly audioWorklet: Pick<AudioWorklet, 'addModule'>;
  close(): Promise<void>;
  createMediaStreamSource(stream: MediaStream): AudioNodeLike;
  resume(): Promise<void>;
}

export interface PcmAudioWorkletProducerOptions {
  audioContextFactory?: () => AudioContextLike;
  audioWorkletNodeFactory?: (context: AudioContextLike) => AudioWorkletNodeLike;
  moduleUrl?: string;
  onBackpressure?: () => void;
  onFailure?: (error: unknown) => void;
  onFrame: (pcm: Uint8Array) => boolean | Promise<boolean>;
}

export class PcmAudioWorkletProducer {
  private context: AudioContextLike | null = null;
  private deliveryChain: Promise<void> = Promise.resolve();
  private disabled = false;
  private node: AudioWorkletNodeLike | null = null;
  private source: AudioNodeLike | null = null;

  public constructor(private readonly options: PcmAudioWorkletProducerOptions) {}

  public async start(stream: MediaStream): Promise<void> {
    if (this.context !== null) throw new Error('PCM producer is already active');
    this.disabled = false;
    const context: AudioContextLike = this.options.audioContextFactory?.() ?? new AudioContext();
    this.context = context;
    try {
      const moduleUrl = this.options.moduleUrl ?? requiredModuleUrl(importedWorkletModuleUrl);
      await context.audioWorklet.addModule(moduleUrl);
      const node: AudioWorkletNodeLike =
        this.options.audioWorkletNodeFactory?.(context) ??
        new AudioWorkletNode(context as AudioContext, PROCESSOR_NAME, {
          channelCountMode: 'max',
          numberOfInputs: 1,
          numberOfOutputs: 0,
        });
      const source = context.createMediaStreamSource(stream);
      this.node = node;
      this.source = source;
      node.port.onmessage = (event: MessageEvent<unknown>): void => {
        this.receive(event.data);
      };
      source.connect(node);
      await context.resume();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    this.disabled = true;
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.port.close();
    this.source = null;
    this.node = null;
    const context = this.context;
    this.context = null;
    if (context !== null) await context.close();
    await this.deliveryChain;
  }

  private receive(value: unknown): void {
    if (this.disabled || !isPcmFrame(value)) return;
    const pcm = new Uint8Array(value.pcm);
    if (pcm.byteLength !== PCM_FRAME_BYTES) {
      this.fail(new Error('INVALID_PCM_WORKLET_FRAME'));
      return;
    }
    this.deliveryChain = this.deliveryChain
      .then(async () => {
        if (this.disabled) return;
        const accepted = await this.options.onFrame(pcm);
        if (!accepted) this.options.onBackpressure?.();
      })
      .catch((error: unknown) => {
        this.fail(error);
      });
  }

  private fail(error: unknown): void {
    if (this.disabled) return;
    this.disabled = true;
    this.options.onFailure?.(error);
  }
}

function requiredModuleUrl(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('PCM worklet module URL is unavailable');
  return value;
}

function isPcmFrame(value: unknown): value is { pcm: ArrayBuffer; type: 'pcm-frame' } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { pcm?: unknown; type?: unknown };
  return candidate.type === 'pcm-frame' && candidate.pcm instanceof ArrayBuffer;
}
