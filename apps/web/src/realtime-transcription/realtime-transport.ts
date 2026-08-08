import {
  INTERVIEW_PCM_FRAME_BYTES,
  INTERVIEW_PCM_FRAME_DURATION_MS,
  INTERVIEW_PCM_SAMPLE_COUNT,
  INTERVIEW_PCM_SAMPLE_RATE_HZ,
  INTERVIEW_WS_PATH,
  INTERVIEW_WS_SCHEMA_VERSION,
  type InterviewWsAudioFramePayload,
  type InterviewWsClientMessage,
  type InterviewWsErrorPayload,
  type InterviewWsServerEnvelope,
  type InterviewWsServerType,
} from '@elder-interview/contracts';

const MAX_PENDING_FRAMES = 20;
const MAX_PENDING_BYTES = 64_000;
const HEARTBEAT_MS = 15_000;
const RECONNECT_DELAYS_MS = [100, 250, 500] as const;

export type RealtimeConnectionStatus =
  'closed' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
export type RealtimeFailureKind = 'asr' | 'auth' | 'internal' | 'permission' | 'reset' | 'session';

export interface RealtimeTranscriptFinal {
  endMs: number;
  segmentId: string;
  speakerRole: 'elder' | 'interviewer' | 'unknown';
  startMs: number;
  text: string;
}

export interface RealtimeTranscriptInterim {
  endMs: number;
  hypothesisId: string;
  revision: number;
  startMs: number;
  text: string;
}

export interface RealtimeState {
  connection: RealtimeConnectionStatus;
  errorCode: string | null;
  failureKind: RealtimeFailureKind | null;
  finals: readonly RealtimeTranscriptFinal[];
  interim: RealtimeTranscriptInterim | null;
  pendingBytes: number;
  pendingFrames: number;
  resetRequired: boolean;
  resumed: boolean;
}

interface PendingFrame {
  payload: InterviewWsAudioFramePayload;
  rawBytes: number;
}

interface SocketLike {
  readonly OPEN: number;
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  send(data: string): void;
  addEventListener(type: 'close', listener: (event: CloseEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<string>) => void): void;
  addEventListener(type: 'open', listener: () => void): void;
}

export interface RealtimeTransportOptions {
  csrfToken: string;
  sessionId: string;
  audioStreamId?: string;
  createSocket?: (url: string) => SocketLike;
  location?: Pick<Location, 'host' | 'protocol'>;
  randomUuid?: () => string;
  reconnectDelaysMs?: readonly number[];
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

export class RealtimeTranscriptionTransport {
  private readonly audioStreamId: string;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly listeners = new Set<(state: RealtimeState) => void>();
  private readonly pending = new Map<number, PendingFrame>();
  private readonly finals = new Map<string, RealtimeTranscriptFinal>();
  private readonly randomUuid: () => string;
  private readonly reconnectDelays: readonly number[];
  private readonly timerApi: Pick<
    typeof globalThis,
    'clearInterval' | 'clearTimeout' | 'setInterval' | 'setTimeout'
  >;
  private readonly url: string;
  private socket: SocketLike | null = null;
  private heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private reconnectAttempt = 0;
  private disposed = false;
  private terminal = false;
  private eventStreamId: string | null = null;
  private highestServerSequence = -1;
  private nextAudioSequence = 0;
  private state: RealtimeState = {
    connection: 'closed',
    errorCode: null,
    failureKind: null,
    finals: [],
    interim: null,
    pendingBytes: 0,
    pendingFrames: 0,
    resetRequired: false,
    resumed: false,
  };

  public constructor(private readonly options: RealtimeTransportOptions) {
    this.audioStreamId = options.audioStreamId ?? options.randomUuid?.() ?? crypto.randomUUID();
    this.randomUuid = options.randomUuid ?? ((): string => crypto.randomUUID());
    this.createSocket = options.createSocket ?? ((url): WebSocket => new WebSocket(url));
    const location = options.location ?? globalThis.location;
    this.url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${INTERVIEW_WS_PATH}`;
    this.reconnectDelays = options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
    this.timerApi = {
      clearInterval: options.clearInterval ?? globalThis.clearInterval.bind(globalThis),
      clearTimeout: options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis),
      setInterval: options.setInterval ?? globalThis.setInterval.bind(globalThis),
      setTimeout: options.setTimeout ?? globalThis.setTimeout.bind(globalThis),
    };
  }

  public connect(): void {
    if (this.disposed || this.terminal || this.socket !== null) return;
    this.patch({ connection: this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting' });
    const socket = this.createSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.disposed || this.terminal) return;
      socket.send(JSON.stringify(this.joinMessage()));
      this.startHeartbeat();
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || this.disposed || this.terminal) return;
      this.onServerMessage(event.data);
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      if (this.disposed || this.terminal) return;
      const closeFailure = classifyClose(event.code, event.reason);
      if (closeFailure !== null) {
        this.terminalFailure(closeFailure.code, closeFailure.kind, closeFailure.resetRequired);
        return;
      }
      if (event.code === 1000) this.patch({ connection: 'closed' });
      else if (!this.state.resetRequired && this.state.failureKind === null)
        this.scheduleReconnect();
    });
  }

  public subscribe(listener: (state: RealtimeState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  public async sendSyntheticFrame(fill = 0): Promise<boolean> {
    return this.sendPcmFrame(new Uint8Array(INTERVIEW_PCM_FRAME_BYTES).fill(fill & 0xff));
  }

  public async sendPcmFrame(pcmBytes: Uint8Array): Promise<boolean> {
    if (pcmBytes.byteLength !== INTERVIEW_PCM_FRAME_BYTES) {
      throw new RangeError(`PCM frames must contain ${String(INTERVIEW_PCM_FRAME_BYTES)} bytes`);
    }
    if (
      this.cannotSendFrames() ||
      this.pending.size >= MAX_PENDING_FRAMES ||
      this.pending.size * INTERVIEW_PCM_FRAME_BYTES >= MAX_PENDING_BYTES
    ) {
      return false;
    }
    const sequence = this.nextAudioSequence;
    const pcm = new Uint8Array(pcmBytes);
    const payload: InterviewWsAudioFramePayload = {
      audio_stream_id: this.audioStreamId,
      channels: 1,
      encoding: 'pcm_s16le',
      end_ms: sequence * INTERVIEW_PCM_FRAME_DURATION_MS + INTERVIEW_PCM_FRAME_DURATION_MS,
      pcm_base64: bytesToBase64(pcm),
      pcm_sha256: await sha256(pcm),
      sample_count: INTERVIEW_PCM_SAMPLE_COUNT,
      sample_rate_hz: INTERVIEW_PCM_SAMPLE_RATE_HZ,
      sequence_no: sequence,
      start_ms: sequence * INTERVIEW_PCM_FRAME_DURATION_MS,
    };
    if (this.cannotSendFrames() || this.pending.size >= MAX_PENDING_FRAMES) return false;
    this.nextAudioSequence += 1;
    this.pending.set(sequence, { payload, rawBytes: pcm.byteLength });
    this.send('audio.frame', payload);
    this.updatePending();
    return true;
  }

  public disconnect(): void {
    this.disposed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) this.timerApi.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, 'client_dispose');
    this.socket = null;
    this.patch({ connection: 'closed' });
  }

  public simulateConnectionDropForHarness(): void {
    if (!this.disposed) this.socket?.close(4001, 'synthetic_network_drop');
  }

  private joinMessage(): InterviewWsClientMessage {
    return {
      event_id: this.randomUuid(),
      payload: {
        audio_stream_id: this.audioStreamId,
        csrf_token: this.options.csrfToken,
        ...(this.eventStreamId === null
          ? {}
          : {
              event_stream_id: this.eventStreamId,
              resume_after_server_sequence: this.highestServerSequence,
            }),
      },
      schema_version: INTERVIEW_WS_SCHEMA_VERSION,
      session_id: this.options.sessionId,
      type: 'session.join',
    };
  }

  private onServerMessage(raw: string): void {
    let message: InterviewWsServerEnvelope<InterviewWsServerType, unknown>;
    try {
      message = JSON.parse(raw) as InterviewWsServerEnvelope<InterviewWsServerType, unknown>;
    } catch {
      this.terminalFailure('INVALID_WS_MESSAGE', 'session', false);
      return;
    }
    if (message.session_id !== this.options.sessionId) return;
    if (this.eventStreamId !== null && message.event_stream_id !== this.eventStreamId) {
      this.terminalFailure('RESUME_WINDOW_EXPIRED', 'reset', true);
      return;
    }
    if (message.server_sequence !== this.highestServerSequence + 1) {
      if (message.server_sequence <= this.highestServerSequence) return;
      this.terminalFailure('RESUME_WINDOW_EXPIRED', 'reset', true);
      return;
    }
    if (!this.apply(message)) return;
    this.eventStreamId = message.event_stream_id;
    this.highestServerSequence = message.server_sequence;
    if (message.type !== 'error')
      this.send('event.ack', { server_sequence: message.server_sequence });
    if (message.type === 'session.ready') this.resendPendingFrames();
  }

  private apply(message: InterviewWsServerEnvelope<InterviewWsServerType, unknown>): boolean {
    if (message.type === 'session.ready') {
      const payload = message.payload as {
        audio_stream_id: string;
        highest_audio_sequence_acked: number;
        resumed: boolean;
      };
      if (payload.audio_stream_id !== this.audioStreamId) {
        this.terminalFailure('INVALID_WS_MESSAGE', 'session', false);
        return false;
      }
      this.acceptAudioAck(payload.highest_audio_sequence_acked);
      this.reconnectAttempt = 0;
      this.patch({ connection: 'connected', resumed: payload.resumed });
    } else if (message.type === 'audio.ack') {
      const payload = message.payload as {
        audio_stream_id: string;
        highest_audio_sequence_acked: number;
      };
      if (payload.audio_stream_id !== this.audioStreamId) {
        this.terminalFailure('INVALID_WS_MESSAGE', 'session', false);
        return false;
      }
      const highest = payload.highest_audio_sequence_acked;
      this.acceptAudioAck(highest);
    } else if (message.type === 'asr.interim') {
      const payload = message.payload as {
        end_ms: number;
        hypothesis_id: string;
        revision: number;
        start_ms: number;
        text: string;
      };
      const current = this.state.interim;
      if (
        current === null ||
        current.hypothesisId !== payload.hypothesis_id ||
        payload.revision > current.revision
      ) {
        this.patch({
          interim: {
            endMs: payload.end_ms,
            hypothesisId: payload.hypothesis_id,
            revision: payload.revision,
            startMs: payload.start_ms,
            text: payload.text,
          },
        });
      }
    } else if (message.type === 'asr.final') {
      const payload = message.payload as {
        end_ms: number;
        segment_id: string;
        speaker_role: RealtimeTranscriptFinal['speakerRole'];
        start_ms: number;
        text: string;
      };
      if (!this.finals.has(payload.segment_id)) {
        this.finals.set(payload.segment_id, {
          endMs: payload.end_ms,
          segmentId: payload.segment_id,
          speakerRole: payload.speaker_role,
          startMs: payload.start_ms,
          text: payload.text,
        });
        this.patch({ finals: [...this.finals.values()], interim: null });
      }
    } else if (message.type === 'asr.status') {
      const payload = message.payload as { code?: string; status: string };
      if (payload.status === 'unavailable')
        this.patch({ errorCode: payload.code ?? null, failureKind: 'asr' });
    } else if (message.type === 'error') {
      const payload = message.payload as InterviewWsErrorPayload;
      const classified = classifyError(payload.code);
      this.terminalFailure(payload.code, classified, payload.reset_required === true);
      return false;
    }
    return true;
  }

  private send(type: InterviewWsClientMessage['type'], payload: unknown): void {
    if (this.terminal) return;
    const socket = this.socket;
    if (socket === null || socket.readyState !== socket.OPEN) return;
    socket.send(
      JSON.stringify({
        event_id: this.randomUuid(),
        payload,
        schema_version: INTERVIEW_WS_SCHEMA_VERSION,
        session_id: this.options.sessionId,
        type,
      }),
    );
  }

  private cannotSendFrames(): boolean {
    return this.disposed || this.terminal;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = this.timerApi.setInterval(() => {
      this.send('heartbeat', {});
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) this.timerApi.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.terminal) return;
    const delay = this.reconnectDelays[this.reconnectAttempt];
    if (delay === undefined) {
      this.terminalFailure('REALTIME_UNAVAILABLE', 'internal', false);
      return;
    }
    this.reconnectAttempt += 1;
    this.patch({ connection: 'reconnecting' });
    this.reconnectTimer = this.timerApi.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private terminalFailure(code: string, kind: RealtimeFailureKind, resetRequired: boolean): void {
    if (this.terminal) return;
    this.terminal = true;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) this.timerApi.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.patch({
      connection: 'unavailable',
      errorCode: code,
      failureKind: kind,
      resetRequired,
    });
    if (socket !== null && socket.readyState === socket.OPEN)
      socket.close(4000, 'client_terminal_failure');
  }

  private updatePending(): void {
    let bytes = 0;
    for (const frame of this.pending.values()) bytes += frame.rawBytes;
    this.patch({ pendingBytes: bytes, pendingFrames: this.pending.size });
  }

  private acceptAudioAck(highest: number): void {
    for (const sequence of this.pending.keys())
      if (sequence <= highest) this.pending.delete(sequence);
    this.nextAudioSequence = Math.max(this.nextAudioSequence, highest + 1);
    this.updatePending();
  }

  private resendPendingFrames(): void {
    for (const frame of this.pending.values()) this.send('audio.frame', frame.payload);
  }

  private patch(patch: Partial<RealtimeState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private snapshot(): RealtimeState {
    return { ...this.state, finals: [...this.state.finals] };
  }
}

export function classifyError(code: string): RealtimeFailureKind {
  if (code === 'AUTH_REQUIRED' || code === 'INVALID_CSRF_TOKEN') return 'auth';
  if (code === 'FORBIDDEN') return 'permission';
  if (code === 'RESUME_WINDOW_EXPIRED') return 'reset';
  if (code === 'ASR_UNAVAILABLE') return 'asr';
  if (code === 'REALTIME_UNAVAILABLE') return 'internal';
  return 'session';
}

function classifyClose(
  closeCode: number,
  reason: string,
): { code: string; kind: RealtimeFailureKind; resetRequired: boolean } | null {
  const code = (fallback: string): string => (reason.length === 0 ? fallback : reason);
  if (closeCode === 4401)
    return { code: code('AUTH_REQUIRED'), kind: 'auth', resetRequired: false };
  if (closeCode === 4403)
    return { code: code('FORBIDDEN'), kind: 'permission', resetRequired: false };
  if (closeCode === 4408)
    return { code: code('SESSION_NOT_STREAMABLE'), kind: 'session', resetRequired: false };
  if (closeCode === 4450)
    return { code: code('RESUME_WINDOW_EXPIRED'), kind: 'reset', resetRequired: true };
  if (closeCode === 4500)
    return { code: code('REALTIME_UNAVAILABLE'), kind: 'internal', resetRequired: false };
  if (closeCode === 4503)
    return { code: code('ASR_UNAVAILABLE'), kind: 'asr', resetRequired: false };
  return null;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', stable.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
