// @vitest-environment jsdom

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyError,
  RealtimeTranscriptionTransport,
  type RealtimeState,
} from './realtime-transport.js';

const SESSION_ID = '10000000-0000-4000-8000-000000000001';
const AUDIO_STREAM_ID = '20000000-0000-4000-8000-000000000002';
const EVENT_STREAM_ID = '30000000-0000-4000-8000-000000000003';

afterEach(() => vi.useRealTimers());

describe('RealtimeTranscriptionTransport', () => {
  it('sends one join first and creates contract PCM with bounded ACK backpressure', async () => {
    const socket = new FakeSocket();
    const { transport, states } = harness([socket]);
    transport.connect();
    socket.open();
    expect(messages(socket)[0]).toMatchObject({
      type: 'session.join',
      payload: { audio_stream_id: AUDIO_STREAM_ID, csrf_token: 'csrf-memory-only' },
    });
    socket.message(server('session.ready', 0, { resumed: false }));

    for (let sequence = 0; sequence < 20; sequence += 1) {
      expect(await transport.sendSyntheticFrame(sequence + 1)).toBe(true);
    }
    expect(await transport.sendSyntheticFrame(99)).toBe(false);
    const frames = messages(socket).filter(({ type }) => type === 'audio.frame');
    expect(frames).toHaveLength(20);
    expect(frames[0]).toMatchObject({
      payload: {
        audio_stream_id: AUDIO_STREAM_ID,
        channels: 1,
        encoding: 'pcm_s16le',
        end_ms: 100,
        sample_count: 1600,
        sample_rate_hz: 16000,
        sequence_no: 0,
        start_ms: 0,
      },
    });
    const firstPcm = new Uint8Array(3200).fill(1);
    expect((frames[0]?.payload as { pcm_sha256: string }).pcm_sha256).toBe(
      createHash('sha256').update(firstPcm).digest('hex'),
    );
    expect(latest(states)).toMatchObject({ pendingBytes: 64_000, pendingFrames: 20 });

    socket.message(
      server('audio.ack', 1, {
        audio_stream_id: AUDIO_STREAM_ID,
        highest_audio_sequence_acked: 9,
      }),
    );
    expect(latest(states)).toMatchObject({ pendingBytes: 32_000, pendingFrames: 10 });
    expect(await transport.sendSyntheticFrame(21)).toBe(true);
    const lastFrame = messages(socket)
      .filter(({ type }) => type === 'audio.frame')
      .at(-1);
    expect(lastFrame).toMatchObject({ payload: { sequence_no: 20, start_ms: 2000 } });
    transport.disconnect();
  });

  it('applies ordered interim revisions, deduplicates final segments, and ACKs applied events', () => {
    const socket = new FakeSocket();
    const { transport, states } = harness([socket]);
    transport.connect();
    socket.open();
    socket.message(server('session.ready', 0, { resumed: false }));
    socket.message(
      server('asr.interim', 1, {
        content_kind: 'conversation',
        end_ms: 100,
        hypothesis_id: 'hypothesis-1',
        revision: 1,
        start_ms: 0,
        text: 'first',
      }),
    );
    socket.message(
      server('asr.interim', 2, {
        content_kind: 'conversation',
        end_ms: 100,
        hypothesis_id: 'hypothesis-1',
        revision: 0,
        start_ms: 0,
        text: 'stale',
      }),
    );
    socket.message(
      server('asr.final', 3, {
        end_ms: 200,
        effective_speaker_role: 'elder',
        finality: 'final',
        segment_id: 'segment-1',
        speaker_role: 'elder',
        speaker_role_authority: 'unconfirmed',
        speaker_role_revision: 0,
        speaker_stream_id: '60000000-0000-4000-8000-000000000006',
        content_kind: 'conversation',
        start_ms: 100,
        text: 'final',
        trusted_effective_speaker_role: 'unknown',
        trusted_speaker_role: 'unknown',
      }),
    );
    socket.message(
      server('asr.final', 4, {
        end_ms: 200,
        effective_speaker_role: 'elder',
        finality: 'final',
        segment_id: 'segment-1',
        speaker_role: 'elder',
        speaker_role_authority: 'unconfirmed',
        speaker_role_revision: 0,
        speaker_stream_id: '60000000-0000-4000-8000-000000000006',
        content_kind: 'conversation',
        start_ms: 100,
        text: 'final',
        trusted_effective_speaker_role: 'unknown',
        trusted_speaker_role: 'unknown',
      }),
    );
    expect(latest(states).interim).toBeNull();
    expect(latest(states).finals).toEqual([
      expect.objectContaining({
        segmentId: 'segment-1',
        speakerRole: 'elder',
        text: 'final',
        trustedSpeakerRole: 'unknown',
      }),
    ]);
    expect(messages(socket).filter(({ type }) => type === 'event.ack')).toHaveLength(5);
  });

  it('replaces the canonical speaker calibration projection from ordered WS 1.1 events', () => {
    const socket = new FakeSocket();
    const { transport, states } = harness([socket]);
    transport.connect();
    socket.open();
    socket.message(server('session.ready', 0, { resumed: false }));
    socket.message(
      server('speaker.calibration.updated', 1, {
        attempt: null,
        session_id: SESSION_ID,
        speaker_role_revision: 0,
        speaker_stream: {
          audio_stream_id: AUDIO_STREAM_ID,
          capture_generation_id: '50000000-0000-4000-8000-000000000005',
          id: '60000000-0000-4000-8000-000000000006',
          status: 'active',
        },
        status: 'not_started',
        updated_at: '2026-08-09T00:00:00.000Z',
      }),
    );
    expect(latest(states).calibration).toMatchObject({
      session_id: SESSION_ID,
      status: 'not_started',
      speaker_stream: { id: '60000000-0000-4000-8000-000000000006' },
    });
  });

  it('reuses both cursors, replays unacknowledged PCM, and cleans reconnect timers', async () => {
    vi.useFakeTimers();
    const first = new FakeSocket();
    const second = new FakeSocket();
    const { transport } = harness([first, second]);
    transport.connect();
    first.open();
    first.message(server('session.ready', 0, { resumed: false }));
    await transport.sendSyntheticFrame(7);
    vi.advanceTimersByTime(15_000);
    expect(messages(first).at(-1)).toMatchObject({ type: 'heartbeat' });

    first.remoteClose(1006);
    vi.advanceTimersByTime(100);
    second.open();
    expect(messages(second)[0]).toMatchObject({
      type: 'session.join',
      payload: {
        audio_stream_id: AUDIO_STREAM_ID,
        event_stream_id: EVENT_STREAM_ID,
        resume_after_server_sequence: 0,
      },
    });
    second.message(server('session.ready', 1, { resumed: true }));
    expect(messages(second).filter(({ type }) => type === 'audio.frame')).toHaveLength(1);
    expect(messages(second).at(-1)).toMatchObject({
      type: 'audio.frame',
      payload: { sequence_no: 0 },
    });
    transport.disconnect();
    const sent = second.sent.length;
    vi.advanceTimersByTime(60_000);
    expect(second.sent).toHaveLength(sent);
  });

  it.each([
    ['AUTH_REQUIRED', 'auth'],
    ['INVALID_CSRF_TOKEN', 'auth'],
    ['FORBIDDEN', 'permission'],
    ['SESSION_NOT_STREAMABLE', 'session'],
    ['RESUME_WINDOW_EXPIRED', 'reset'],
    ['ASR_UNAVAILABLE', 'asr'],
    ['REALTIME_UNAVAILABLE', 'internal'],
  ] as const)('classifies %s as %s', (code, kind) => {
    expect(classifyError(code)).toBe(kind);
  });

  it.each([
    ['INVALID_CSRF_TOKEN', 4401, 'auth'],
    ['FORBIDDEN', 4403, 'permission'],
    ['SESSION_NOT_STREAMABLE', 4408, 'session'],
  ] as const)('terminates a failed join as %s without reconnecting', (code, closeCode, kind) => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const { transport, states } = harness([socket]);
    transport.connect();
    socket.open();
    socket.message(server('error', 0, { code }));
    socket.remoteClose(closeCode, code);

    expect(latest(states)).toMatchObject({
      connection: 'unavailable',
      errorCode: code,
      failureKind: kind,
    });
    expect(messages(socket).filter(({ type }) => type === 'event.ack')).toHaveLength(0);
    expect(socket.readyState).toBe(3);
    const sent = socket.sent.length;
    vi.advanceTimersByTime(60_000);
    expect(socket.sent).toHaveLength(sent);
  });

  it('classifies a join close code when its error envelope is lost', () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const { transport, states } = harness([socket]);
    transport.connect();
    socket.open();
    socket.remoteClose(4403, 'FORBIDDEN');

    expect(latest(states)).toMatchObject({
      connection: 'unavailable',
      errorCode: 'FORBIDDEN',
      failureKind: 'permission',
    });
    const sent = socket.sent.length;
    vi.advanceTimersByTime(60_000);
    expect(socket.sent).toHaveLength(sent);
  });

  it('fails reset explicitly on an event gap without ACK or later sends', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const { transport, states } = harness([socket]);
    transport.connect();
    socket.open();
    socket.message(server('session.ready', 0, { resumed: false }));
    const ackCount = messages(socket).filter(({ type }) => type === 'event.ack').length;
    socket.message(server('heartbeat.ack', 2, {}));
    expect(latest(states)).toMatchObject({
      errorCode: 'RESUME_WINDOW_EXPIRED',
      failureKind: 'reset',
      resetRequired: true,
    });
    expect(messages(socket).filter(({ type }) => type === 'event.ack')).toHaveLength(ackCount);
    expect(socket.readyState).toBe(3);
    expect(await transport.sendSyntheticFrame(1)).toBe(false);
    const sent = socket.sent.length;
    vi.advanceTimersByTime(60_000);
    expect(socket.sent).toHaveLength(sent);
  });

  it.each(['session.ready', 'audio.ack'] as const)(
    'does not accept %s for a different audio stream',
    async (type) => {
      vi.useFakeTimers();
      const socket = new FakeSocket();
      const { transport, states } = harness([socket]);
      transport.connect();
      socket.open();
      expect(await transport.sendSyntheticFrame(7)).toBe(true);
      let framesBefore: number;
      let acknowledgementsBefore: number;
      if (type === 'session.ready') {
        framesBefore = messages(socket).filter(
          ({ type: sentType }) => sentType === 'audio.frame',
        ).length;
        acknowledgementsBefore = messages(socket).filter(
          ({ type: sentType }) => sentType === 'event.ack',
        ).length;
        socket.message(
          server(type, 0, {
            audio_stream_id: 'wrong-audio-stream',
            highest_audio_sequence_acked: -1,
            resumed: false,
          }),
        );
      } else {
        socket.message(server('session.ready', 0, { resumed: false }));
        framesBefore = messages(socket).filter(
          ({ type: sentType }) => sentType === 'audio.frame',
        ).length;
        acknowledgementsBefore = messages(socket).filter(
          ({ type: sentType }) => sentType === 'event.ack',
        ).length;
        socket.message(
          server(type, 1, {
            audio_stream_id: 'wrong-audio-stream',
            highest_audio_sequence_acked: 10,
          }),
        );
      }
      expect(latest(states)).toMatchObject({
        errorCode: 'INVALID_WS_MESSAGE',
        failureKind: 'session',
        pendingFrames: 1,
      });
      expect(socket.readyState).toBe(3);
      expect(
        messages(socket).filter(({ type: sentType }) => sentType === 'event.ack'),
      ).toHaveLength(acknowledgementsBefore);
      expect(
        messages(socket).filter(({ type: sentType }) => sentType === 'audio.frame'),
      ).toHaveLength(framesBefore);
      expect(await transport.sendSyntheticFrame(8)).toBe(false);
      const sent = socket.sent.length;
      vi.advanceTimersByTime(60_000);
      expect(socket.sent).toHaveLength(sent);
    },
  );
});

function harness(sockets: FakeSocket[]): {
  states: RealtimeState[];
  transport: RealtimeTranscriptionTransport;
} {
  let uuid = 0;
  const states: RealtimeState[] = [];
  const transport = new RealtimeTranscriptionTransport({
    audioStreamId: AUDIO_STREAM_ID,
    createSocket: (): FakeSocket => {
      const socket = sockets.shift();
      if (socket === undefined) throw new Error('No fake socket available');
      return socket;
    },
    csrfToken: 'csrf-memory-only',
    location: { host: 'example.test', protocol: 'https:' },
    randomUuid: (): string => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
    sessionId: SESSION_ID,
  });
  transport.subscribe((state) => states.push(state));
  return { states, transport };
}

function latest(states: RealtimeState[]): RealtimeState {
  const state = states.at(-1);
  if (state === undefined) throw new Error('State missing');
  return state;
}

function messages(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent.map((message) => JSON.parse(message) as Record<string, unknown>);
}

function server(type: string, sequence: number, payload: unknown): string {
  const normalizedPayload =
    type === 'session.ready'
      ? {
          audio_stream_id: AUDIO_STREAM_ID,
          highest_audio_sequence_acked: -1,
          ...(payload as Record<string, unknown>),
        }
      : payload;
  return JSON.stringify({
    event_id: `40000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    event_stream_id: EVENT_STREAM_ID,
    payload: normalizedPayload,
    schema_version: '1.1',
    server_sequence: sequence,
    session_id: SESSION_ID,
    timestamp: '2026-08-07T00:00:00.000Z',
    type,
  });
}

class FakeSocket {
  public readonly OPEN = 1;
  public readyState = 0;
  public readonly sent: string[] = [];
  private readonly listeners = {
    close: [] as Array<(event: CloseEvent) => void>,
    message: [] as Array<(event: MessageEvent<string>) => void>,
    open: [] as Array<() => void>,
  };

  public addEventListener(type: 'close' | 'message' | 'open', listener: never): void {
    (this.listeners[type] as never[]).push(listener);
  }

  public open(): void {
    this.readyState = this.OPEN;
    for (const listener of this.listeners.open) listener();
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public message(data: string): void {
    for (const listener of this.listeners.message) listener(new MessageEvent('message', { data }));
  }

  public close(code = 1000, reason = ''): void {
    this.remoteClose(code, reason);
  }

  public remoteClose(code: number, reason = ''): void {
    this.readyState = 3;
    for (const listener of this.listeners.close)
      listener(new CloseEvent('close', { code, reason }));
  }
}
