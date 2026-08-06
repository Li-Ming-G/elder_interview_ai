import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { RealtimeRuntimeService } from './realtime-runtime.service.js';

describe('RealtimeRuntimeService', () => {
  it('keeps server sequence ordered and rejects invalid replay cursors', () => {
    const service = new RealtimeRuntimeService();
    const runtime = service.create(randomUUID(), randomUUID());
    expect(service.append(runtime, 'heartbeat.ack', {}).server_sequence).toBe(0);
    expect(service.append(runtime, 'heartbeat.ack', {}).server_sequence).toBe(1);
    expect(
      service.replayAfter(runtime, 0)?.map(({ envelope }) => envelope.server_sequence),
    ).toEqual([1]);
    expect(service.replayAfter(runtime, 2)).toBeNull();
  });

  it('caps replay at 512 events without renumbering retained envelopes', () => {
    const service = new RealtimeRuntimeService();
    const runtime = service.create(randomUUID(), randomUUID());
    for (let index = 0; index < 513; index += 1) service.append(runtime, 'heartbeat.ack', {});
    expect(runtime.events).toHaveLength(512);
    expect(runtime.events[0]?.envelope.server_sequence).toBe(1);
    expect(service.replayAfter(runtime, -1)).toBeNull();
    expect(service.replayAfter(runtime, 0)?.[0]?.envelope.server_sequence).toBe(1);
  });
});
