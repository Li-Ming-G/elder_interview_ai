// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { PcmAudioWorkletProducer } from './pcm-audio-worklet-producer.js';

class TestAudioNode {
  public connect(destination: unknown): this {
    void destination;
    return this;
  }

  public disconnect(): void {}
}

class TestWorkletNode extends TestAudioNode {
  public constructor(public readonly port: MessagePort) {
    super();
  }
}

describe('PcmAudioWorkletProducer', () => {
  it('bounds teardown when an in-flight onFrame and AudioContext.close never settle', async () => {
    let resolveFrame: ((accepted: boolean) => void) | undefined;
    const frameResult = new Promise<boolean>((resolve) => {
      resolveFrame = resolve;
    });
    const onFrame = vi.fn(() => frameResult);
    const onBackpressure = vi.fn();
    const closePort = vi.fn();
    const port = {
      close: closePort,
      onmessage: null,
    } as unknown as MessagePort;
    const node = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      port,
    };
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const context = {
      audioWorklet: { addModule: (): Promise<void> => Promise.resolve() },
      close: (): Promise<void> => new Promise(() => undefined),
      createMediaStreamSource: (): typeof source => source,
      resume: (): Promise<void> => Promise.resolve(),
    };
    const producer = new PcmAudioWorkletProducer({
      audioContextFactory: (): typeof context => context,
      audioWorkletNodeFactory: (): typeof node => node,
      moduleUrl: 'fictional-worklet.js',
      onBackpressure,
      onFrame,
      teardownTimeoutMs: 5,
    });

    await producer.start({} as MediaStream);
    const message = new MessageEvent('message', {
      data: { pcm: new ArrayBuffer(3_200), type: 'pcm-frame' },
    });
    port.onmessage?.call(port, message);
    await vi.waitFor(() => {
      expect(onFrame).toHaveBeenCalledOnce();
    });

    await expect(producer.stop()).resolves.toBeUndefined();
    resolveFrame?.(false);
    await Promise.resolve();

    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(closePort).toHaveBeenCalledOnce();
    expect(onBackpressure).not.toHaveBeenCalled();
  });

  it.each(['resolve-false', 'reject'] as const)(
    'isolates an old generation when its frame later %s',
    async (outcome) => {
      let resolveOld: ((accepted: boolean) => void) | undefined;
      let rejectOld: ((error: Error) => void) | undefined;
      const oldFrame = new Promise<boolean>((resolve, reject) => {
        resolveOld = resolve;
        rejectOld = reject;
      });
      const onFrame = vi
        .fn<(pcm: Uint8Array) => Promise<boolean>>()
        .mockImplementationOnce(() => oldFrame)
        .mockResolvedValue(true);
      const onBackpressure = vi.fn();
      const onFailure = vi.fn();
      const ports: MessagePort[] = [];
      const producer = new PcmAudioWorkletProducer({
        audioContextFactory: (): {
          audioWorklet: { addModule: () => Promise<void> };
          close: () => Promise<void>;
          createMediaStreamSource: () => TestAudioNode;
          resume: () => Promise<void>;
        } => ({
          audioWorklet: { addModule: (): Promise<void> => Promise.resolve() },
          close: (): Promise<void> => new Promise(() => undefined),
          createMediaStreamSource: (): TestAudioNode => new TestAudioNode(),
          resume: (): Promise<void> => Promise.resolve(),
        }),
        audioWorkletNodeFactory: (): TestWorkletNode => {
          const port = { close: vi.fn(), onmessage: null } as unknown as MessagePort;
          ports.push(port);
          return new TestWorkletNode(port);
        },
        moduleUrl: 'fictional-worklet.js',
        onBackpressure,
        onFailure,
        onFrame,
        teardownTimeoutMs: 1,
      });

      await producer.start({} as MediaStream);
      sendFrame(ports[0]);
      await vi.waitFor(() => {
        expect(onFrame).toHaveBeenCalledOnce();
      });
      await producer.stop();
      await producer.start({} as MediaStream);

      if (outcome === 'resolve-false') resolveOld?.(false);
      else rejectOld?.(new Error('old generation rejection'));
      await Promise.resolve();
      await Promise.resolve();
      expect(onBackpressure).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();

      sendFrame(ports[1]);
      await vi.waitFor(() => {
        expect(onFrame).toHaveBeenCalledTimes(2);
      });
      expect(onBackpressure).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
      await producer.stop();
    },
  );
});

function sendFrame(port: MessagePort | undefined): void {
  if (port === undefined) throw new Error('worklet port missing');
  const message = new MessageEvent('message', {
    data: { pcm: new ArrayBuffer(3_200), type: 'pcm-frame' },
  });
  port.onmessage?.call(port, message);
}
