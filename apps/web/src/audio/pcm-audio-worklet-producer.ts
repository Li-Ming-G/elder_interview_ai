import workletModuleUrl from './interview-pcm-worklet.ts?worker&url';

const importedWorkletModuleUrl: unknown = workletModuleUrl;

const PCM_FRAME_BYTES = 3_200;
const PROCESSOR_NAME = 'interview-pcm-processor';
const DEFAULT_TEARDOWN_TIMEOUT_MS = 250;

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
  teardownTimeoutMs?: number;
}

export class PcmAudioWorkletProducer {
  private context: AudioContextLike | null = null;
  private deliveryChain: Promise<void> = Promise.resolve();
  private disabled = false;
  private generation = 0;
  private node: AudioWorkletNodeLike | null = null;
  private source: AudioNodeLike | null = null;

  public constructor(private readonly options: PcmAudioWorkletProducerOptions) {}

  public async start(stream: MediaStream): Promise<void> {
    if (this.context !== null) throw new Error('PCM producer is already active');
    const generation = ++this.generation;
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
        this.receive(event.data, generation);
      };
      source.connect(node);
      await context.resume();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    this.generation += 1;
    this.disabled = true;
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.port.close();
    this.source = null;
    this.node = null;
    this.deliveryChain = Promise.resolve();
    const context = this.context;
    this.context = null;
    if (context !== null) {
      await settleWithin(
        context.close(),
        this.options.teardownTimeoutMs ?? DEFAULT_TEARDOWN_TIMEOUT_MS,
      );
    }
  }

  private receive(value: unknown, generation: number): void {
    if (!this.isGenerationActive(generation) || !isPcmFrame(value)) return;
    const pcm = new Uint8Array(value.pcm);
    if (pcm.byteLength !== PCM_FRAME_BYTES) {
      this.fail(new Error('INVALID_PCM_WORKLET_FRAME'), generation);
      return;
    }
    this.deliveryChain = this.deliveryChain
      .then(async () => {
        if (!this.isGenerationActive(generation)) return;
        const accepted = await this.options.onFrame(pcm);
        if (!this.isGenerationActive(generation)) return;
        if (!accepted) this.options.onBackpressure?.();
      })
      .catch((error: unknown) => {
        this.fail(error, generation);
      });
  }

  private fail(error: unknown, generation: number): void {
    if (!this.isGenerationActive(generation)) return;
    this.disabled = true;
    try {
      this.options.onFailure?.(error);
    } catch {
      // Failure observers cannot create an unhandled delivery-chain rejection.
    }
  }

  private isGenerationActive(generation: number): boolean {
    return !this.disabled && this.generation === generation;
  }
}

function settleWithin(operation: Promise<void>, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return Promise.reject(new RangeError('PCM teardown timeout is invalid'));
  }
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(resolve, timeoutMs);
    operation.then(
      () => {
        globalThis.clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(
          error instanceof Error ? error : new Error('PCM context close failed', { cause: error }),
        );
      },
    );
  });
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
