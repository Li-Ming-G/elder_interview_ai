import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { CausalQueue, RealtimeRuntimeService } from './realtime-runtime.service.js';

describe('RealtimeRuntimeService', () => {
  it('keeps server sequence ordered and rejects invalid replay cursors', async () => {
    const service = new RealtimeRuntimeService();
    const runtime = await service.create(
      randomUUID(),
      randomUUID(),
      randomUUID(),
      new CausalQueue(),
    );
    expect(service.append(runtime, 'heartbeat.ack', {}).server_sequence).toBe(0);
    expect(service.append(runtime, 'heartbeat.ack', {}).server_sequence).toBe(1);
    expect(
      service.replayAfter(runtime, 0)?.map(({ envelope }) => envelope.server_sequence),
    ).toEqual([1]);
    expect(service.replayAfter(runtime, 2)).toBeNull();
  });

  it('caps replay at 512 events without renumbering retained envelopes', async () => {
    const service = new RealtimeRuntimeService();
    const runtime = await service.create(
      randomUUID(),
      randomUUID(),
      randomUUID(),
      new CausalQueue(),
    );
    for (let index = 0; index < 513; index += 1) service.append(runtime, 'heartbeat.ack', {});
    expect(runtime.events).toHaveLength(512);
    expect(runtime.events[0]?.envelope.server_sequence).toBe(1);
    expect(service.replayAfter(runtime, -1)).toBeNull();
    expect(service.replayAfter(runtime, 0)?.[0]?.envelope.server_sequence).toBe(1);
  });

  it('interrupts only the capture stream named by a replay cleanup target', async () => {
    const service = new RealtimeRuntimeService();
    const sessionId = randomUUID();
    const oldStreamId = randomUUID();
    const newStreamId = randomUUID();
    const oldRuntime = await service.create(
      sessionId,
      oldStreamId,
      randomUUID(),
      new CausalQueue(),
    );
    const oldProducer = {};
    service.claim(oldRuntime, oldProducer);
    expect(service.interruptCapture(sessionId, oldStreamId)).toBe(true);
    expect(oldRuntime.producer).toBeNull();

    const newRuntime = await service.create(
      sessionId,
      newStreamId,
      randomUUID(),
      new CausalQueue(),
    );
    const newProducer = {};
    const lease = service.claim(newRuntime, newProducer);
    expect(service.interruptCapture(sessionId, oldStreamId)).toBe(false);
    expect(service.isProducerLeaseCurrent(newRuntime, newProducer, lease)).toBe(true);
  });
});
