import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

import type { AuthPrincipal } from '../auth/auth.types.js';
import {
  RealtimeAccessService,
  type RealtimeJoinAccess,
  type RealtimeSessionMode,
} from './realtime-access.service.js';
import { WS_AUTH, type AuthenticatedUpgradeRequest } from './realtime-auth.js';
import { RealtimeRuntimeService } from './realtime-runtime.service.js';
import { RealtimeTranscriptionGateway } from './realtime.gateway.js';
import { DeterministicStreamingAsrFake, StreamingAsrAdapter } from './streaming-asr.js';

const actor: AuthPrincipal = {
  displayName: '虚构测试倾听员',
  id: randomUUID(),
  role: 'interviewer',
  sessionId: randomUUID(),
  sessionTokenHash: 'test-only-hash',
  status: 'active',
};

describe('RealtimeTranscriptionGateway serialization', () => {
  it('returns after resume-only join without a cursor', async () => {
    const adapter = new CountingAdapter();
    const gateway = createGateway(adapter, 'resume-only');
    const client = new FakeSocket();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(randomUUID(), randomUUID()));
    await client.waitClosed();
    expect(client.sent.map((message) => message.type)).toEqual(['error']);
    expect(client.sent[0]?.payload).toEqual({ code: 'SESSION_NOT_STREAMABLE' });
    expect(adapter.calls).toBe(0);
  });

  it('binds the requested session to an error raised during join authorization', async () => {
    const sessionId = randomUUID();
    const adapter = new CountingAdapter();
    const gateway = createGateway(adapter, 'produce', undefined, undefined, undefined, () =>
      Promise.reject(new ForbiddenException({ code: 'FORBIDDEN' })),
    );
    const client = new FakeSocket();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, randomUUID()));
    await client.waitClosed();

    expect(client.closeCode).toBe(4403);
    expect(client.sent[0]).toMatchObject({
      payload: { code: 'FORBIDDEN' },
      session_id: sessionId,
      type: 'error',
    });
    expect(adapter.openCalls).toBe(0);
  });

  it('serializes concurrent frames on one connection', async () => {
    const adapter = new CountingAdapter();
    const gateway = createGateway(adapter, 'produce');
    const client = new FakeSocket();
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, audioStreamId));
    await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
    client.receive(frame(sessionId, audioStreamId, 0));
    client.receive(frame(sessionId, audioStreamId, 1));
    await waitFor(() => client.sent.filter(({ type }) => type === 'audio.ack').length === 2);
    expect(adapter.calls).toBe(2);
    expect(adapter.maximumConcurrent).toBe(1);
    expect(
      client.sent
        .filter(({ type }) => type === 'audio.ack')
        .map(({ payload }) => payload.highest_audio_sequence_acked),
    ).toEqual([0, 1]);
    client.close(1000);
  });

  it('does not call the adapter for queued frames after close', async () => {
    const adapter = new CountingAdapter(30);
    const gateway = createGateway(adapter, 'produce');
    const client = new FakeSocket();
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, audioStreamId));
    await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
    client.receive(frame(sessionId, audioStreamId, 0));
    client.receive(frame(sessionId, audioStreamId, 1));
    await waitFor(() => adapter.calls === 1);
    client.close(1000);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(adapter.calls).toBe(1);
  });

  it('serializes same-sequence conflict and never calls the adapter twice', async () => {
    const adapter = new CountingAdapter();
    const gateway = createGateway(adapter, 'produce');
    const client = new FakeSocket();
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, audioStreamId));
    await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
    client.receive(frame(sessionId, audioStreamId, 0, 1));
    client.receive(frame(sessionId, audioStreamId, 0, 9));
    await client.waitClosed();
    expect(adapter.calls).toBe(1);
    expect(client.closeCode).toBe(4409);
    expect(client.sent.at(-1)?.payload).toEqual({ code: 'AUDIO_FRAME_CONFLICT' });
  });

  it('rejects the twenty-first queued frame and never invokes its adapter call', async () => {
    const adapter = new CountingAdapter(5);
    const gateway = createGateway(adapter, 'produce');
    const client = new FakeSocket();
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, audioStreamId));
    await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
    for (let sequence = 0; sequence <= 20; sequence += 1) {
      client.receive(frame(sessionId, audioStreamId, sequence));
    }
    await client.waitClosed();
    expect(client.closeCode).toBe(4429);
    expect(adapter.calls).toBe(20);
    expect(client.sent.at(-1)?.payload).toEqual({ code: 'BACKPRESSURE_LIMIT' });
  });

  it('rejects a sequence gap without invoking the adapter', async () => {
    const adapter = new CountingAdapter();
    const gateway = createGateway(adapter, 'produce');
    const client = new FakeSocket();
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, audioStreamId));
    await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
    client.receive(frame(sessionId, audioStreamId, 1));
    await client.waitClosed();
    expect(client.closeCode).toBe(4409);
    expect(adapter.calls).toBe(0);
    expect(client.sent.at(-1)?.payload).toEqual({ code: 'AUDIO_FRAME_GAP' });
  });

  it('rejects regressing and future event acknowledgements', async () => {
    const adapter = new CountingAdapter();
    const gateway = createGateway(adapter, 'produce');
    const first = new FakeSocket();
    const firstSession = randomUUID();
    gateway.handleConnection(first as unknown as WebSocket, request());
    first.receive(join(firstSession, randomUUID()));
    await waitFor(() => first.sent.some(({ type }) => type === 'session.ready'));
    first.receive(eventAck(firstSession, 0));
    first.receive(heartbeat(firstSession));
    await waitFor(() => first.sent.some(({ type }) => type === 'heartbeat.ack'));
    first.receive(eventAck(firstSession, 1));
    first.receive(eventAck(firstSession, 0));
    await first.waitClosed();
    expect(first.closeCode).toBe(4400);

    const second = new FakeSocket();
    const secondSession = randomUUID();
    gateway.handleConnection(second as unknown as WebSocket, request());
    second.receive(join(secondSession, randomUUID()));
    await waitFor(() => second.sent.some(({ type }) => type === 'session.ready'));
    second.receive(eventAck(secondSession, 99));
    await second.waitClosed();
    expect(second.closeCode).toBe(4400);
  });

  it('returns reset-required for a mismatched recovery stream', async () => {
    const runtimes = new RealtimeRuntimeService();
    const gateway = createGateway(new CountingAdapter(), 'produce', runtimes);
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    const first = new FakeSocket();
    gateway.handleConnection(first as unknown as WebSocket, request());
    first.receive(join(sessionId, audioStreamId));
    await waitFor(() => first.sent.some(({ type }) => type === 'session.ready'));
    first.close(1000);
    await waitFor(() => runtimes.find(sessionId)?.producer === null);

    const second = new FakeSocket();
    gateway.handleConnection(second as unknown as WebSocket, request());
    second.receive(join(sessionId, audioStreamId, randomUUID(), 0));
    await second.waitClosed();
    expect(second.closeCode).toBe(4450);
    expect(second.sent.at(-1)?.payload).toEqual({
      code: 'RESUME_WINDOW_EXPIRED',
      reset_required: true,
    });
  });

  it('returns reset-required when the recovery cursor has been evicted', async () => {
    const runtimes = new RealtimeRuntimeService();
    const gateway = createGateway(new CountingAdapter(), 'produce', runtimes);
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    const first = new FakeSocket();
    gateway.handleConnection(first as unknown as WebSocket, request());
    first.receive(join(sessionId, audioStreamId));
    await waitFor(() => first.sent.some(({ type }) => type === 'session.ready'));
    const runtime = runtimes.find(sessionId);
    if (runtime === null) throw new Error('Expected session runtime');
    for (let index = 0; index < 513; index += 1) {
      runtimes.append(runtime, 'heartbeat.ack', {});
    }
    first.close(1000);
    await waitFor(() => runtime.producer === null);

    const second = new FakeSocket();
    gateway.handleConnection(second as unknown as WebSocket, request());
    second.receive(join(sessionId, audioStreamId, runtime.eventStreamId, 0));
    await second.waitClosed();
    expect(second.closeCode).toBe(4450);
    expect(second.sent.at(-1)?.payload).toEqual({
      code: 'RESUME_WINDOW_EXPIRED',
      reset_required: true,
    });
  });

  it('enforces one active producer per session', async () => {
    const gateway = createGateway(new CountingAdapter(), 'produce');
    const sessionId = randomUUID();
    const first = new FakeSocket();
    gateway.handleConnection(first as unknown as WebSocket, request());
    first.receive(join(sessionId, randomUUID()));
    await waitFor(() => first.sent.some(({ type }) => type === 'session.ready'));

    const second = new FakeSocket();
    gateway.handleConnection(second as unknown as WebSocket, request());
    second.receive(join(sessionId, randomUUID()));
    await second.waitClosed();
    expect(second.closeCode).toBe(4408);
    expect(second.sent.at(-1)?.payload).toEqual({ code: 'SESSION_STREAM_ALREADY_ACTIVE' });
    first.close(1000);
  });

  it('allows recovery to replace a producer socket that is already closed', async () => {
    const runtimes = new RealtimeRuntimeService();
    const gateway = createGateway(new CountingAdapter(), 'produce', runtimes);
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    const first = new FakeSocket();
    gateway.handleConnection(first as unknown as WebSocket, request());
    first.receive(join(sessionId, audioStreamId));
    await waitFor(() => first.sent.some(({ type }) => type === 'session.ready'));
    const runtime = runtimes.find(sessionId);
    if (runtime === null) throw new Error('Expected session runtime');
    first.close(4001);
    runtime.producer = first;

    const second = new FakeSocket();
    gateway.handleConnection(second as unknown as WebSocket, request());
    second.receive(join(sessionId, audioStreamId, runtime.eventStreamId, 0));
    await waitFor(() => second.sent.some(({ type }) => type === 'session.ready'));

    expect(second.closeCode).toBe(0);
    expect(runtime.producer).toBe(second);
    second.close(1000);
  });

  it('publishes degraded ASR without closing the recording socket when the local fake faults', async () => {
    const runtimes = new RealtimeRuntimeService();
    let ingestionCalls = 0;
    const gateway = createGateway(new DeterministicStreamingAsrFake(), 'produce', runtimes, () => {
      ingestionCalls += 1;
      return Promise.resolve({
        contentKind: 'conversation',
        kind: 'interim',
        persisted: false,
      });
    });
    const client = new FakeSocket();
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, audioStreamId));
    await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
    client.receive(frame(sessionId, audioStreamId, 0));
    client.receive(frame(sessionId, audioStreamId, 1));
    await waitFor(() => client.sent.filter(({ type }) => type === 'audio.ack').length === 2);
    expect(ingestionCalls).toBe(3);
    expect(
      client.sent
        .filter(({ type }) => type === 'asr.interim')
        .map(({ payload }) => payload.content_kind),
    ).toEqual(['conversation', 'conversation', 'conversation']);
    expect(runtimes.find(sessionId)?.highestAudioSequenceAcked).toBe(1);

    client.receive(frame(sessionId, audioStreamId, 2));
    await waitFor(() =>
      client.sent.some(
        ({ payload, type }) => type === 'asr.status' && payload.status === 'unavailable',
      ),
    );
    expect(client.readyState).toBe(client.OPEN);
    expect(ingestionCalls).toBe(3);
    expect(runtimes.find(sessionId)?.highestAudioSequenceAcked).toBe(1);
    expect(client.sent.filter(({ type }) => type === 'audio.ack')).toHaveLength(2);
    expect(client.sent.some(({ type }) => type === 'error')).toBe(false);
  });

  it('marks sticky evidence loss when a runtime is rebuilt after persisted PCM acceptance', async () => {
    const adapter = new CountingAdapter();
    const gateway = createGateway(
      adapter,
      'produce',
      new RealtimeRuntimeService(),
      undefined,
      undefined,
      () =>
        Promise.resolve({
          acceptedPcmEvidenceExists: true,
          captureGenerationId: randomUUID(),
          mode: 'produce',
          timelineOffsetMs: 12_300,
        }),
    );
    const client = new FakeSocket();
    const sessionId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, randomUUID()));

    await waitFor(() => adapter.coverageGaps.length === 1);
    expect(adapter.coverageGaps).toEqual([
      {
        endSequence: null,
        reason: 'evidence_lost',
        sessionId,
        startSequence: null,
      },
    ]);
    client.close(1000);
  });

  it.each(['heartbeat', 'event.ack'] as const)(
    'rechecks resources for %s and releases a revoked producer',
    async (messageType) => {
      const runtimes = new RealtimeRuntimeService();
      const adapter = new CountingAdapter();
      let allowed = true;
      const gateway = createGateway(adapter, 'produce', runtimes, undefined, () =>
        allowed
          ? Promise.resolve('produce')
          : Promise.reject(
              new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'denied' }),
            ),
      );
      const client = new FakeSocket();
      const sessionId = randomUUID();
      gateway.handleConnection(client as unknown as WebSocket, request());
      client.receive(join(sessionId, randomUUID()));
      await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
      allowed = false;
      client.receive(messageType === 'heartbeat' ? heartbeat(sessionId) : eventAck(sessionId, 0));
      await client.waitClosed();
      expect(client.closeCode).toBe(4403);
      expect(client.sent.at(-1)?.payload).toEqual({ code: 'FORBIDDEN' });
      await waitFor(() => runtimes.find(sessionId)?.producer === null);
      expect(adapter.cancelCalls).toBe(1);
    },
  );

  it('maps unknown internal failures to a non-sensitive 4500 error', async () => {
    let accessChecks = 0;
    const gateway = createGateway(new CountingAdapter(), 'produce', undefined, undefined, () => {
      accessChecks += 1;
      return accessChecks === 1
        ? Promise.resolve('produce')
        : Promise.reject(new Error('database-name SQL secret stack'));
    });
    const client = new FakeSocket();
    const sessionId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, randomUUID()));
    await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
    client.receive(heartbeat(sessionId));
    await client.waitClosed();
    expect(client.closeCode).toBe(4500);
    expect(client.sent.at(-1)?.payload).toEqual({ code: 'REALTIME_UNAVAILABLE' });
    expect(JSON.stringify(client.sent)).not.toContain('database-name');
    expect(JSON.stringify(client.sent)).not.toContain('SQL');
  });

  it('fails closed without recording or ACK when PCM evidence cannot be persisted', async () => {
    const runtimes = new RealtimeRuntimeService();
    const adapter = new CountingAdapter();
    const gateway = createGateway(
      adapter,
      'produce',
      runtimes,
      undefined,
      undefined,
      undefined,
      async (accept) => {
        await accept();
        throw new Error('test-only evidence write failure');
      },
    );
    const client = new FakeSocket();
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, audioStreamId));
    await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
    client.receive(frame(sessionId, audioStreamId, 0));
    await client.waitClosed();

    expect(adapter.calls).toBe(1);
    expect(client.closeCode).toBe(4500);
    expect(client.sent.at(-1)?.payload).toEqual({ code: 'REALTIME_UNAVAILABLE' });
    expect(client.sent.some(({ type }) => type === 'audio.ack')).toBe(false);
    expect(runtimes.find(sessionId)?.highestAudioSequenceAcked).toBe(-1);
  });

  it('does not ACK an adapter result after the producer lease is interrupted', async () => {
    const runtimes = new RealtimeRuntimeService();
    let acceptStarted: (() => void) | undefined;
    let releaseAccept: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      acceptStarted = resolve;
    });
    const blocked = new Promise<readonly []>((resolve) => {
      releaseAccept = (): void => {
        resolve([]);
      };
    });
    const adapter = {
      accept: () => {
        acceptStarted?.();
        return blocked;
      },
      drainAndClose: () => Promise.resolve(),
    } as StreamingAsrAdapter;
    const gateway = createGateway(adapter, 'produce', runtimes);
    const client = new FakeSocket();
    const sessionId = randomUUID();
    const audioStreamId = randomUUID();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.receive(join(sessionId, audioStreamId));
    await waitFor(() => client.sent.some(({ type }) => type === 'session.ready'));
    client.receive(frame(sessionId, audioStreamId, 0));
    await started;

    expect(runtimes.interruptCapture(sessionId, audioStreamId)).toBe(true);
    releaseAccept?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(client.sent.some(({ type }) => type === 'audio.ack')).toBe(false);
    expect(runtimes.find(sessionId)?.highestAudioSequenceAcked).toBe(-1);
  });
});

function createGateway(
  adapter: StreamingAsrAdapter,
  mode: RealtimeSessionMode,
  runtimes = new RealtimeRuntimeService(),
  ingest: () => Promise<unknown> = () =>
    Promise.resolve({ contentKind: 'conversation', kind: 'interim', persisted: false }),
  assertActiveConnection: () => Promise<RealtimeSessionMode> = () => Promise.resolve('produce'),
  assertJoin: () => Promise<RealtimeJoinAccess> = () =>
    Promise.resolve({
      acceptedPcmEvidenceExists: false,
      captureGenerationId: mode === 'produce' ? randomUUID() : null,
      mode,
      timelineOffsetMs: mode === 'produce' ? 0 : null,
    }),
  acceptAndPersist: <T>(accept: () => Promise<T>) => Promise<T> = (accept) => accept(),
): RealtimeTranscriptionGateway {
  const access = {
    assertActiveConnection,
    assertFrame: () => Promise.resolve('produce' as const),
    assertJoin,
    authenticate: () => Promise.resolve(actor),
  } as unknown as RealtimeAccessService;
  const ingestion = {
    ingest,
  };
  return new RealtimeTranscriptionGateway(
    access,
    runtimes,
    adapter,
    ingestion as never,
    {
      acceptAndPersist: <T>(_sessionId: string, _audioStreamId: string, accept: () => Promise<T>) =>
        acceptAndPersist(accept),
    } as never,
    {
      get: (sessionId: string) =>
        Promise.resolve({
          attempt: null,
          session_id: sessionId,
          speaker_role_revision: 0,
          speaker_stream: null,
          status: 'not_started',
          updated_at: new Date(0).toISOString(),
        }),
    } as never,
  );
}

class CountingAdapter extends StreamingAsrAdapter {
  public cancelCalls = 0;
  public calls = 0;
  public maximumConcurrent = 0;
  public openCalls = 0;
  public readonly coverageGaps: Array<{
    endSequence: number | null;
    reason: string;
    sessionId: string;
    startSequence: number | null;
  }> = [];
  private concurrent = 0;

  public constructor(private readonly delayMs = 10) {
    super();
  }

  public open(): Promise<void> {
    this.openCalls += 1;
    return Promise.resolve();
  }

  public async accept(): Promise<{
    acceptedThroughSequence: number;
    attemptId: string;
    providerNamespaceId: string;
    providerRequestId: string;
    scope: 'attempt';
    speakerStreamId: string;
  }> {
    this.calls += 1;
    this.concurrent += 1;
    this.maximumConcurrent = Math.max(this.maximumConcurrent, this.concurrent);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.concurrent -= 1;
    return {
      acceptedThroughSequence: this.calls - 1,
      attemptId: '00000000-0000-4000-8000-000000000091',
      providerNamespaceId: 'counting-namespace',
      providerRequestId: 'counting-request',
      scope: 'attempt',
      speakerStreamId: '00000000-0000-4000-8000-000000000092',
    };
  }

  public cancel(): Promise<void> {
    this.cancelCalls += 1;
    return Promise.resolve();
  }

  public completeness(): ReturnType<StreamingAsrAdapter['completeness']> {
    return {
      clearAuthority: 'HARDEN-ASR-001',
      completeCaptureCoverageProven: true,
      scope: 'session_capture',
      status: 'no_known_gap',
      stickyDegraded: false,
      unbackfilledGaps: [],
    };
  }

  public drainAndClose(): ReturnType<StreamingAsrAdapter['drainAndClose']> {
    return Promise.resolve({
      acceptedThroughSequence: this.calls - 1,
      attemptId: '00000000-0000-4000-8000-000000000091',
      completedAt: new Date().toISOString(),
      providerFinalObserved: true,
      providerNamespaceId: 'counting-namespace',
      providerRequestId: 'counting-request',
      resultsIngested: true,
      scope: 'attempt',
      speakerStreamId: '00000000-0000-4000-8000-000000000092',
      terminalThroughSequence: this.calls - 1,
    });
  }

  public markCoverageGap(
    sessionId: string,
    reason: string,
    startSequence: number | null,
    endSequence: number | null,
  ): void {
    this.coverageGaps.push({ endSequence, reason, sessionId, startSequence });
  }
}

class FakeSocket extends EventEmitter {
  public readonly OPEN = 1;
  public readyState = this.OPEN;
  public readonly sent: Array<{
    payload: Record<string, unknown>;
    session_id: string;
    type: string;
  }> = [];
  public closeCode = 0;

  public send(value: string): void {
    this.sent.push(
      JSON.parse(value) as {
        payload: Record<string, unknown>;
        session_id: string;
        type: string;
      },
    );
  }

  public receive(value: Record<string, unknown>): void {
    this.emit('message', Buffer.from(JSON.stringify(value)), false);
  }

  public close(code: number): void {
    if (this.readyState !== this.OPEN) return;
    this.readyState = 3;
    this.closeCode = code;
    this.emit('close', code);
  }

  public async waitClosed(): Promise<number> {
    if (this.readyState !== this.OPEN) return this.closeCode;
    return new Promise((resolve) => this.once('close', resolve));
  }
}

function request(): AuthenticatedUpgradeRequest {
  return {
    [WS_AUTH]: { principal: actor, sessionToken: 'test-token' },
  } as AuthenticatedUpgradeRequest;
}

function join(
  sessionId: string,
  audioStreamId: string,
  eventStreamId?: string,
  resumeAfterServerSequence?: number,
): Record<string, unknown> {
  return {
    event_id: randomUUID(),
    payload: {
      audio_stream_id: audioStreamId,
      csrf_token: 'test-csrf',
      ...(eventStreamId === undefined
        ? {}
        : {
            event_stream_id: eventStreamId,
            resume_after_server_sequence: resumeAfterServerSequence,
          }),
    },
    schema_version: '1.1',
    session_id: sessionId,
    type: 'session.join',
  };
}

function eventAck(sessionId: string, sequence: number): Record<string, unknown> {
  return {
    event_id: randomUUID(),
    payload: { server_sequence: sequence },
    schema_version: '1.1',
    session_id: sessionId,
    type: 'event.ack',
  };
}

function heartbeat(sessionId: string): Record<string, unknown> {
  return {
    event_id: randomUUID(),
    payload: {},
    schema_version: '1.1',
    session_id: sessionId,
    type: 'heartbeat',
  };
}

function frame(
  sessionId: string,
  audioStreamId: string,
  sequence: number,
  fill = sequence + 1,
): Record<string, unknown> {
  const pcm = Buffer.alloc(3200, fill);
  return {
    event_id: randomUUID(),
    payload: {
      audio_stream_id: audioStreamId,
      channels: 1,
      encoding: 'pcm_s16le',
      end_ms: sequence * 100 + 100,
      pcm_base64: pcm.toString('base64'),
      pcm_sha256: createHash('sha256').update(pcm).digest('hex'),
      sample_count: 1600,
      sample_rate_hz: 16000,
      sequence_no: sequence,
      start_ms: sequence * 100,
    },
    schema_version: '1.1',
    session_id: sessionId,
    type: 'audio.frame',
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for gateway state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
