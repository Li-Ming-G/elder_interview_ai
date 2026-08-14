import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import type { AsrConfig } from '@elder-interview/config';
import { Inject, Injectable, Optional } from '@nestjs/common';
import WebSocket, { type RawData } from 'ws';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import {
  type AttemptDrainReceipt,
  type SessionCaptureCompleteness,
  type StreamingAcceptReceipt,
  StreamingAsrAdapter,
  StreamingAsrError,
  type StreamingAsrTransportDiagnostic,
  type StreamingAsrAttemptIdentity,
  type StreamingAsrOpenContext,
  type StreamingAsrResult,
  type StreamingCoverageGap,
  type StreamingEndContext,
  type StreamingFrameContext,
  type StreamingGapReason,
} from './streaming-asr.js';
import { StreamingAsrMetrics } from './streaming-asr.metrics.js';

const PROVIDER_HOST = 'asr.cloud.tencent.com';
const PROVIDER_PACKET_BYTES = 6_400;
const FRAME_BYTES = 3_200;
const PACKET_INTERVAL_MS = 200;
const RECONNECT_BACKOFF_MS = [250, 1_000] as const;
const MAX_BUFFERED_FRAMES = 20;

export const TENCENT_ASR_CONNECTION_FACTORY = Symbol('TENCENT_ASR_CONNECTION_FACTORY');

export interface TencentProtocolConnection {
  close(): void;
  onClose(listener: (code?: number) => void): void;
  onError(listener: (error: unknown) => void): void;
  onMessage(listener: (message: string) => void): void;
  sendBinary(data: Uint8Array): Promise<void>;
  sendText(data: string): Promise<void>;
}

export interface TencentProtocolConnectionFactory {
  connect(url: string, signal: AbortSignal): Promise<TencentProtocolConnection>;
}

interface BufferedFrame {
  bytes: Buffer;
  endMs: number;
  sequence: number;
  startMs: number;
}

interface TencentAttempt {
  acceptedThroughSequence: number;
  attemptedBytes: number;
  connectController: AbortController | null;
  connection: TencentProtocolConnection | null;
  ending: boolean;
  failed: boolean;
  failure: StreamingAsrError | null;
  finalSentenceIds: Set<number>;
  finalObserved: boolean;
  firstFinalObserved: boolean;
  firstFrameStartMs: number | null;
  firstFrameAcceptedAt: number | null;
  firstInterimObserved: boolean;
  generation: number;
  identity: StreamingAsrAttemptIdentity;
  inFlightResults: number;
  lastSpeakerProviderId: string | null;
  nextSendAt: number;
  providerEndSent: boolean;
  pump: Promise<void> | null;
  queue: BufferedFrame[];
  ready: boolean;
  readyPromise: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  sentBytes: number;
  terminalThroughSequence: number;
}

interface TencentSession {
  active: TencentAttempt | null;
  closed: boolean;
  context: StreamingAsrOpenContext;
  gaps: StreamingCoverageGap[];
  generation: number;
  reconnects: number;
  transition: Promise<void> | null;
}

interface TencentProviderSentence {
  end_time?: unknown;
  sentence?: unknown;
  sentence_id?: unknown;
  sentence_type?: unknown;
  speaker_id?: unknown;
  start_time?: unknown;
}

interface TencentProviderMessage {
  code?: unknown;
  final?: unknown;
  message_id?: unknown;
  result?: { sentences?: unknown; speaker_sentences?: unknown };
  sentences?: unknown;
  voice_id?: unknown;
}

export interface TencentSignedUrlInput {
  appId: string;
  engineModelType: '16k_zh_en_speaker_2.0';
  nonce: number;
  secretId: string;
  secretKey: string;
  timestampSeconds: number;
  voiceId: string;
}

export function buildTencentSignedUrl(input: TencentSignedUrlInput): string {
  const parameters = new Map<string, string>([
    ['convert_num_mode', '1'],
    ['enable_speaker_context', '0'],
    ['engine_model_type', input.engineModelType],
    ['expired', String(input.timestampSeconds + 300)],
    ['needvad', '1'],
    ['nonce', String(input.nonce)],
    ['reinforce_hotword', '0'],
    ['secretid', input.secretId],
    ['sentence_strategy', '1'],
    ['speaker_diarization', '1'],
    ['timestamp', String(input.timestampSeconds)],
    ['voice_format', '1'],
    ['voice_id', input.voiceId],
  ]);
  const canonicalQuery = [...parameters.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const signature = createHmac('sha1', input.secretKey)
    .update(`${PROVIDER_HOST}/asr/v2/${input.appId}?${canonicalQuery}`)
    .digest('base64');
  const query = new URLSearchParams([...parameters.entries(), ['signature', signature]]);
  return `wss://${PROVIDER_HOST}/asr/v2/${encodeURIComponent(input.appId)}?${query.toString()}`;
}

export class TencentAsrBudgetLedger {
  private activeConnections = 0;
  private billedSeconds = 0;
  private chargedCny = 0;
  private day = utcDay(new Date());

  public constructor(
    private readonly maxConcurrency: number,
    private readonly maxBilledSeconds: number,
    private readonly maxCny: number,
  ) {}

  public acquire(now = new Date()): void {
    this.rollDay(now);
    if (
      this.activeConnections >= this.maxConcurrency ||
      this.billedSeconds >= this.maxBilledSeconds ||
      this.chargedCny >= this.maxCny
    ) {
      throw new StreamingAsrError('quota', false, 'ASR_QUOTA_EXHAUSTED');
    }
    this.activeConnections += 1;
  }

  public release(sentBytes: number): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    this.billedSeconds += Math.ceil(sentBytes / 32_000);
  }

  public recordCharge(cny: number): void {
    if (Number.isFinite(cny) && cny >= 0) this.chargedCny += cny;
  }

  public snapshot(): { activeConnections: number; billedSeconds: number; chargedCny: number } {
    return {
      activeConnections: this.activeConnections,
      billedSeconds: this.billedSeconds,
      chargedCny: this.chargedCny,
    };
  }

  private rollDay(now: Date): void {
    const nextDay = utcDay(now);
    if (nextDay === this.day) return;
    this.day = nextDay;
    this.activeConnections = 0;
    this.billedSeconds = 0;
    this.chargedCny = 0;
  }
}

@Injectable()
export class TencentRealtimeAsrV2Adapter extends StreamingAsrAdapter {
  private readonly asr: Extract<AsrConfig, { provider: 'tencent_realtime_asr_v2' }>;
  private readonly budget: TencentAsrBudgetLedger;
  private readonly factory: TencentProtocolConnectionFactory;
  private readonly sessions = new Map<string, TencentSession>();

  public constructor(
    @Inject(API_CONFIG) config: ApiConfigValue,
    private readonly metrics: StreamingAsrMetrics,
    @Optional()
    @Inject(TENCENT_ASR_CONNECTION_FACTORY)
    factory?: TencentProtocolConnectionFactory,
  ) {
    super();
    if (config.asr.provider !== 'tencent_realtime_asr_v2') {
      throw new StreamingAsrError('provider', false, 'ASR_PROVIDER_UNAVAILABLE');
    }
    this.asr = config.asr;
    this.budget = new TencentAsrBudgetLedger(
      this.asr.maxConcurrency,
      this.asr.dailyBilledSeconds,
      this.asr.dailyBudgetCny,
    );
    this.factory = factory ?? new WsTencentProtocolConnectionFactory();
  }

  public async open(context: StreamingAsrOpenContext): Promise<void> {
    const previous = this.sessions.get(context.sessionId);
    await this.cancel(context.sessionId);
    const previousGaps = [...(previous?.gaps ?? [])];
    const session: TencentSession = {
      active: null,
      closed: false,
      context,
      gaps: previousGaps,
      generation: 0,
      reconnects: 0,
      transition: null,
    };
    this.sessions.set(context.sessionId, session);
    if (context.signal?.aborted === true) {
      session.closed = true;
      throw new StreamingAsrError('cancelled', false, 'ASR_CANCELLED');
    }
    context.signal?.addEventListener(
      'abort',
      () => {
        void this.cancel(context.sessionId);
      },
      { once: true },
    );
    await this.startAttempt(session, context.initialSpeakerStreamId, 0);
  }

  public accept(context: StreamingFrameContext): Promise<StreamingAcceptReceipt> {
    return this.acceptNow(context);
  }

  private async acceptNow({
    frame,
    sessionId,
    signal,
  }: StreamingFrameContext): Promise<StreamingAcceptReceipt> {
    if (signal.aborted) throw new StreamingAsrError('cancelled', false, 'ASR_CANCELLED');
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.closed) {
      throw new StreamingAsrError('provider', true, 'ASR_PROVIDER_UNAVAILABLE');
    }
    const attempt = session.active;
    if (attempt === null || attempt.ending) {
      throw new StreamingAsrError('provider', true, 'ASR_PROVIDER_UNAVAILABLE');
    }
    if (attempt.failed) {
      attempt.acceptedThroughSequence = frame.sequence_no;
      this.addGap(
        session,
        attempt,
        'provider_error_unaccounted_pcm',
        frame.sequence_no,
        frame.sequence_no,
      );
      return {
        ...attempt.identity,
        acceptedThroughSequence: frame.sequence_no,
        scope: 'attempt',
      };
    }
    while (attempt.queue.length >= MAX_BUFFERED_FRAMES && !this.attemptFailed(attempt)) {
      if (abortSignalTriggered(signal)) {
        throw new StreamingAsrError('timeout', true, 'ASR_TIMEOUT');
      }
      await delay(5);
    }
    if (this.attemptFailed(attempt)) {
      attempt.acceptedThroughSequence = frame.sequence_no;
      this.addGap(
        session,
        attempt,
        'provider_error_unaccounted_pcm',
        frame.sequence_no,
        frame.sequence_no,
      );
      return {
        ...attempt.identity,
        acceptedThroughSequence: frame.sequence_no,
        scope: 'attempt',
      };
    }
    const bytes = Buffer.from(frame.pcm_base64, 'base64');
    if (
      bytes.byteLength !== FRAME_BYTES ||
      createHash('sha256').update(bytes).digest('hex') !== frame.pcm_sha256
    ) {
      throw new StreamingAsrError('audio', false, 'ASR_AUDIO_INVALID');
    }
    attempt.queue.push({
      bytes,
      endMs: frame.end_ms,
      sequence: frame.sequence_no,
      startMs: frame.start_ms,
    });
    attempt.acceptedThroughSequence = frame.sequence_no;
    attempt.firstFrameStartMs ??= frame.start_ms;
    attempt.firstFrameAcceptedAt ??= Date.now();
    this.metrics.increment('asr_pcm_accepted_bytes_total', bytes.byteLength);
    this.metrics.increment('asr_pcm_accepted_duration_ms_total', frame.end_ms - frame.start_ms);
    this.metrics.gauge('asr_pcm_accepted_through_sequence', frame.sequence_no);
    this.startPump(session, attempt);
    return {
      ...attempt.identity,
      acceptedThroughSequence: frame.sequence_no,
      scope: 'attempt',
    };
  }

  public async drainAndClose({
    sessionId,
    signal,
  }: StreamingEndContext): Promise<AttemptDrainReceipt> {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.closed) {
      throw new StreamingAsrError('provider', false, 'ASR_PROVIDER_UNAVAILABLE');
    }
    if (session.transition !== null) await abortable(session.transition, signal);
    const attempt = session.active;
    if (attempt === null || attempt.failed) {
      throw (
        attempt?.failure ?? new StreamingAsrError('provider', false, 'ASR_PROVIDER_UNAVAILABLE')
      );
    }
    attempt.ending = true;
    const startedAt = Date.now();
    try {
      await abortable(attempt.readyPromise, signal);
      await this.flushAll(attempt, signal);
      await attempt.connection?.sendText(JSON.stringify({ type: 'end' }));
      attempt.providerEndSent = true;
      await withDeadline(
        () => this.waitForDrain(session, attempt),
        this.asr.drainTimeoutMs,
        signal,
      );
      const receipt: AttemptDrainReceipt = {
        ...attempt.identity,
        acceptedThroughSequence: attempt.acceptedThroughSequence,
        completedAt: new Date().toISOString(),
        providerFinalObserved: true,
        resultsIngested: true,
        scope: 'attempt',
        terminalThroughSequence: attempt.terminalThroughSequence,
      };
      this.metrics.increment('asr_drain_outcome_drained_total');
      this.metrics.gauge('asr_drain_latency_ms', Date.now() - startedAt);
      session.closed = true;
      attempt.connection?.close();
      this.releaseAttempt(attempt);
      return receipt;
    } catch (error: unknown) {
      const previouslyFailed = this.attemptFailed(attempt);
      if (!previouslyFailed && attempt.terminalThroughSequence < attempt.acceptedThroughSequence) {
        this.addGap(
          session,
          attempt,
          'drain_timeout_unaccounted_pcm',
          attempt.terminalThroughSequence + 1,
          attempt.acceptedThroughSequence,
        );
      }
      attempt.failed = true;
      session.closed = true;
      attempt.connectController?.abort();
      attempt.connection?.close();
      this.releaseAttempt(attempt);
      this.metrics.increment('asr_drain_outcome_degraded_total');
      const normalized = attempt.failure ?? normalizeError(error, 'timeout');
      if (!previouslyFailed) await session.context.onStatus?.(normalized);
      throw normalized;
    }
  }

  public cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return Promise.resolve();
    session.closed = true;
    const attempt = session.active;
    if (attempt !== null && attempt.terminalThroughSequence < attempt.acceptedThroughSequence) {
      this.addGap(
        session,
        attempt,
        'cancelled_unaccounted_pcm',
        attempt.terminalThroughSequence + 1,
        attempt.acceptedThroughSequence,
      );
    }
    attempt?.connectController?.abort();
    attempt?.rejectReady(new StreamingAsrError('cancelled', false, 'ASR_CANCELLED'));
    if (attempt !== null) attempt.failed = true;
    attempt?.connection?.close();
    if (attempt !== null) this.releaseAttempt(attempt);
    return Promise.resolve();
  }

  public markCoverageGap(
    sessionId: string,
    reason: StreamingGapReason,
    startSequence: number | null,
    endSequence: number | null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    this.addGap(session, session.active, reason, startSequence, endSequence);
  }

  public completeness(sessionId: string): SessionCaptureCompleteness {
    const gaps = this.sessions.get(sessionId)?.gaps ?? [];
    return gaps.length === 0
      ? {
          clearAuthority: 'HARDEN-ASR-001',
          completeCaptureCoverageProven: true,
          scope: 'session_capture',
          status: 'no_known_gap',
          stickyDegraded: false,
          unbackfilledGaps: [],
        }
      : {
          clearAuthority: 'HARDEN-ASR-001',
          completeCaptureCoverageProven: false,
          scope: 'session_capture',
          status: 'known_unbackfilled_gap',
          stickyDegraded: true,
          unbackfilledGaps: [...gaps],
        };
  }

  private async startAttempt(
    session: TencentSession,
    speakerStreamId: string,
    backoffMs: number,
  ): Promise<void> {
    if (backoffMs > 0) await delay(backoffMs);
    if (session.closed) throw new StreamingAsrError('cancelled', false, 'ASR_CANCELLED');
    this.budget.acquire();
    const voiceId = randomUUID();
    const identity: StreamingAsrAttemptIdentity = {
      attemptId: randomUUID(),
      providerNamespaceId: voiceId,
      providerRequestId: opaqueId(voiceId),
      speakerStreamId,
    };
    let resolveReady = (): void => undefined;
    let rejectReady: (error: Error) => void = () => undefined;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // Transport setup can fail before startAttempt begins awaiting the provider-ready
    // promise. Mark that promise handled immediately; later awaits still observe the
    // original rejection, while Node cannot terminate the API for an orphan rejection.
    void readyPromise.catch(() => undefined);
    const attempt: TencentAttempt = {
      acceptedThroughSequence: -1,
      attemptedBytes: 0,
      connectController: null,
      connection: null,
      ending: false,
      failed: false,
      failure: null,
      finalSentenceIds: new Set(),
      finalObserved: false,
      firstFinalObserved: false,
      firstFrameAcceptedAt: null,
      firstFrameStartMs: null,
      firstInterimObserved: false,
      generation: ++session.generation,
      identity,
      inFlightResults: 0,
      lastSpeakerProviderId: null,
      nextSendAt: Date.now(),
      providerEndSent: false,
      pump: null,
      queue: [],
      ready: false,
      readyPromise,
      rejectReady,
      resolveReady,
      sentBytes: 0,
      terminalThroughSequence: -1,
    };
    session.active = attempt;
    try {
      await session.context.onAttempt(identity);
    } catch (error: unknown) {
      attempt.failed = true;
      this.releaseAttempt(attempt);
      throw normalizeError(error, 'provider');
    }
    const controller = new AbortController();
    attempt.connectController = controller;
    const url = buildTencentSignedUrl({
      appId: this.asr.appId,
      engineModelType: this.asr.engineModelType,
      nonce: randomInt(1, 2_147_483_647),
      secretId: this.asr.secretId,
      secretKey: this.asr.secretKey,
      timestampSeconds: Math.floor(Date.now() / 1_000),
      voiceId,
    });
    try {
      const connectStartedAt = Date.now();
      const connection = await withDeadline(
        () => this.factory.connect(url, controller.signal),
        this.asr.connectTimeoutMs,
      );
      this.metrics.gauge('asr_connect_latency_ms', Date.now() - connectStartedAt);
      attempt.connection = connection;
      connection.onMessage((message) => {
        void this.handleMessage(session, attempt, message);
      });
      connection.onClose((code) => {
        if (attempt.finalObserved) return;
        void this.handleConnectionFailure(session, attempt, mapTencentWebSocketClose(code));
      });
      connection.onError((error) => {
        void this.handleConnectionFailure(session, attempt, normalizeError(error, 'network'));
      });
      const readyStartedAt = Date.now();
      await withDeadline(() => readyPromise, this.asr.readyTimeoutMs);
      attempt.connectController = null;
      this.metrics.gauge('asr_ready_latency_ms', Date.now() - readyStartedAt);
      this.metrics.increment('asr_connect_success_total');
      if (session.reconnects > 0) this.metrics.increment('asr_reconnect_success_total');
      this.startPump(session, attempt);
    } catch (error: unknown) {
      controller.abort();
      await this.handleConnectionFailure(session, attempt, normalizeError(error, 'timeout'));
      throw normalizeError(error, 'timeout');
    }
  }

  private async handleMessage(
    session: TencentSession,
    attempt: TencentAttempt,
    raw: string,
  ): Promise<void> {
    if (!this.isCurrent(session, attempt)) return;
    let message: TencentProviderMessage;
    try {
      message = JSON.parse(raw) as TencentProviderMessage;
    } catch {
      await this.handleConnectionFailure(
        session,
        attempt,
        new StreamingAsrError('protocol', false, 'ASR_PROTOCOL_INVALID'),
      );
      return;
    }
    const code = asInteger(message.code);
    if (code === null) {
      await this.handleConnectionFailure(
        session,
        attempt,
        new StreamingAsrError('protocol', false, 'ASR_PROTOCOL_INVALID'),
      );
      return;
    }
    if (code !== 0) {
      await this.handleConnectionFailure(session, attempt, mapTencentError(code));
      return;
    }
    if (
      typeof message.voice_id === 'string' &&
      message.voice_id !== attempt.identity.providerNamespaceId
    ) {
      await this.handleConnectionFailure(
        session,
        attempt,
        new StreamingAsrError('protocol', false, 'ASR_PROTOCOL_INVALID'),
      );
      return;
    }
    if (!attempt.ready) {
      attempt.ready = true;
      attempt.resolveReady();
    }
    if (message.final === 1) attempt.finalObserved = true;
    const sentences = providerSentences(message);
    for (const sentence of sentences) {
      const sentenceId = asInteger(sentence.sentence_id);
      const sentenceType = asInteger(sentence.sentence_type);
      if (sentenceId === null || attempt.finalSentenceIds.has(sentenceId)) continue;
      if (sentenceType === 1) attempt.finalSentenceIds.add(sentenceId);
      const result = mapTencentSentence(session.context.sessionId, attempt, message, sentence);
      if (result === null || !this.isCurrent(session, attempt)) continue;
      attempt.inFlightResults += 1;
      const sinkStartedAt = Date.now();
      try {
        await session.context.onResult(result);
        this.metrics.increment(
          result.kind === 'final' ? 'asr_final_results_total' : 'asr_interim_results_total',
        );
        if (result.speakerProviderId === null) this.metrics.increment('asr_unknown_speaker_total');
        if (attempt.firstFrameAcceptedAt !== null) {
          if (result.kind === 'interim' && !attempt.firstInterimObserved) {
            attempt.firstInterimObserved = true;
            this.metrics.gauge(
              'asr_first_interim_latency_ms',
              Date.now() - attempt.firstFrameAcceptedAt,
            );
          }
          if (result.kind === 'final' && !attempt.firstFinalObserved) {
            attempt.firstFinalObserved = true;
            this.metrics.gauge(
              'asr_first_final_latency_ms',
              Date.now() - attempt.firstFrameAcceptedAt,
            );
          }
        }
        if (result.kind === 'final') {
          this.metrics.increment('asr_final_persistence_success_total');
          this.metrics.gauge('asr_final_persistence_latency_ms', Date.now() - sinkStartedAt);
          if (
            result.speakerProviderId !== null &&
            attempt.lastSpeakerProviderId !== null &&
            result.speakerProviderId !== attempt.lastSpeakerProviderId
          ) {
            this.metrics.increment('asr_speaker_label_switch_total');
          }
          attempt.lastSpeakerProviderId = result.speakerProviderId ?? null;
        }
      } catch (error: unknown) {
        if (result.kind === 'final') this.metrics.increment('asr_final_persistence_failure_total');
        await this.handleConnectionFailure(session, attempt, normalizeError(error, 'provider'));
        return;
      } finally {
        this.metrics.gauge('asr_result_sink_latency_ms', Date.now() - sinkStartedAt);
        attempt.inFlightResults -= 1;
      }
    }
  }

  private startPump(session: TencentSession, attempt: TencentAttempt): void {
    if (!attempt.ready || attempt.pump !== null || attempt.failed) return;
    attempt.pump = this.pump(session, attempt)
      .catch((error: unknown) =>
        this.handleConnectionFailure(session, attempt, normalizeError(error, 'network')),
      )
      .finally(() => {
        attempt.pump = null;
        if (attempt.queue.length >= 2 && this.isCurrent(session, attempt))
          this.startPump(session, attempt);
      });
  }

  private async pump(session: TencentSession, attempt: TencentAttempt): Promise<void> {
    while (attempt.queue.length >= 2 && this.isCurrent(session, attempt) && !attempt.failed) {
      const pair = attempt.queue.splice(0, 2);
      await this.pacedSend(attempt, Buffer.concat(pair.map(({ bytes }) => bytes)));
      attempt.terminalThroughSequence = pair[1]?.sequence ?? pair[0]?.sequence ?? -1;
      this.metrics.gauge('asr_pcm_sent_through_sequence', attempt.terminalThroughSequence);
    }
  }

  private async flushAll(attempt: TencentAttempt, signal?: AbortSignal): Promise<void> {
    if (attempt.pump !== null) await abortable(attempt.pump, signal);
    if (this.attemptFailed(attempt)) {
      throw attempt.failure ?? new StreamingAsrError('provider', true, 'ASR_PROVIDER_UNAVAILABLE');
    }
    while (attempt.queue.length > 0) {
      if (this.attemptFailed(attempt)) {
        throw (
          attempt.failure ?? new StreamingAsrError('provider', true, 'ASR_PROVIDER_UNAVAILABLE')
        );
      }
      const frames = attempt.queue.splice(0, Math.min(2, attempt.queue.length));
      const bytes = Buffer.concat(frames.map(({ bytes: pcm }) => pcm));
      await abortable(this.pacedSend(attempt, bytes), signal);
      attempt.terminalThroughSequence = frames.at(-1)?.sequence ?? attempt.terminalThroughSequence;
      this.metrics.gauge('asr_pcm_sent_through_sequence', attempt.terminalThroughSequence);
    }
  }

  private async pacedSend(attempt: TencentAttempt, packet: Buffer): Promise<void> {
    if (packet.byteLength !== PROVIDER_PACKET_BYTES && packet.byteLength !== FRAME_BYTES) {
      throw new StreamingAsrError('audio', false, 'ASR_AUDIO_INVALID');
    }
    const waitMs = Math.max(0, attempt.nextSendAt - Date.now());
    if (waitMs > 0) await delay(waitMs);
    attempt.attemptedBytes += packet.byteLength;
    this.metrics.increment('asr_pcm_send_attempted_bytes_total', packet.byteLength);
    await attempt.connection?.sendBinary(packet);
    const packetIntervalMs = (packet.byteLength / PROVIDER_PACKET_BYTES) * PACKET_INTERVAL_MS;
    attempt.nextSendAt = Math.max(attempt.nextSendAt + packetIntervalMs, Date.now());
    attempt.sentBytes += packet.byteLength;
    this.metrics.increment('asr_pcm_sent_bytes_total', packet.byteLength);
    this.metrics.increment('asr_pcm_sent_duration_ms_total', packetIntervalMs);
  }

  private async waitForDrain(session: TencentSession, attempt: TencentAttempt): Promise<void> {
    while (this.isCurrent(session, attempt)) {
      if (
        attempt.providerEndSent &&
        attempt.finalObserved &&
        attempt.terminalThroughSequence === attempt.acceptedThroughSequence &&
        attempt.inFlightResults === 0
      ) {
        return;
      }
      await delay(10);
    }
    throw new StreamingAsrError('cancelled', false, 'ASR_CANCELLED');
  }

  private async handleConnectionFailure(
    session: TencentSession,
    attempt: TencentAttempt,
    error: StreamingAsrError,
  ): Promise<void> {
    if (!this.isCurrent(session, attempt) || attempt.failed || session.closed) return;
    attempt.failed = true;
    attempt.failure = error;
    attempt.rejectReady(error);
    attempt.connectController?.abort();
    attempt.connection?.close();
    this.releaseAttempt(attempt);
    this.metrics.increment(`asr_provider_error_${error.safeCode.toLowerCase()}_total`);
    try {
      await session.context.onStatus?.(error);
    } catch {
      // A presentation callback cannot escape the provider failure state machine.
    }
    if (attempt.terminalThroughSequence < attempt.acceptedThroughSequence) {
      this.addGap(
        session,
        attempt,
        attempt.ready ? 'provider_error_unaccounted_pcm' : 'ready_timeout_unaccounted_pcm',
        attempt.terminalThroughSequence + 1,
        attempt.acceptedThroughSequence,
      );
    }
    if (!error.retryable || session.reconnects >= this.asr.reconnectMaxAttempts) return;
    const retryIndex = session.reconnects;
    session.reconnects += 1;
    this.metrics.increment('asr_reconnect_attempt_total');
    session.transition = (async (): Promise<void> => {
      const speakerStreamId = await session.context.rotateSpeakerStream();
      await this.startAttempt(session, speakerStreamId, RECONNECT_BACKOFF_MS[retryIndex] ?? 1_000);
    })().finally(() => {
      session.transition = null;
    });
    try {
      await session.transition;
    } catch {
      // The safe status callback already exposes the degraded provider state.
    }
  }

  private addGap(
    session: TencentSession,
    attempt: TencentAttempt | null,
    reason: StreamingGapReason,
    startSequence: number | null,
    endSequence: number | null,
  ): void {
    session.gaps.push({
      backfillStatus: 'unbackfilled',
      endSequence,
      reason,
      sourceAttemptId: attempt?.identity.attemptId ?? null,
      startSequence,
    });
    this.metrics.increment('asr_capture_gap_total');
  }

  private isCurrent(session: TencentSession, attempt: TencentAttempt): boolean {
    return !session.closed && !attempt.failed && session.active?.generation === attempt.generation;
  }

  private attemptFailed(attempt: TencentAttempt): boolean {
    return attempt.failed;
  }

  private releaseAttempt(attempt: TencentAttempt): void {
    if (attempt.sentBytes < 0) return;
    // A transport callback can fail after bytes entered the socket. Budget against
    // attempted bytes so a failed acknowledgement cannot undercount provider spend.
    this.budget.release(attempt.attemptedBytes);
    this.metrics.gauge('asr_billed_duration_seconds', this.budget.snapshot().billedSeconds);
    attempt.sentBytes = -1;
  }
}

export class WsTencentProtocolConnectionFactory implements TencentProtocolConnectionFactory {
  public connect(url: string, signal: AbortSignal): Promise<TencentProtocolConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { perMessageDeflate: false });
      const connection = new WsTencentProtocolConnection(socket);
      let settled = false;
      const rejectOnce = (error: StreamingAsrError): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      };
      const onAbort = (): void => {
        socket.close();
        rejectOnce(new StreamingAsrError('cancelled', false, 'ASR_CANCELLED'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      socket.once('open', () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(connection);
      });
      socket.once('unexpected-response', (_request, response) => {
        const httpStatus = safeHttpStatus(response.statusCode);
        response.resume();
        rejectOnce(
          new StreamingAsrError('network', true, 'ASR_PROVIDER_UNAVAILABLE', undefined, {
            ...(httpStatus === undefined ? {} : { httpStatus }),
            errorClass: 'http_upgrade_rejected',
            phase: 'upgrade',
          }),
        );
      });
      socket.once('error', (error) => {
        rejectOnce(classifyTencentTransportError(error));
      });
    });
  }
}

class WsTencentProtocolConnection implements TencentProtocolConnection {
  private readonly closeListeners: Array<(code?: number) => void> = [];
  private readonly errorListeners: Array<(error: unknown) => void> = [];
  private readonly messageListeners: Array<(message: string) => void> = [];
  private closedCode: number | undefined;
  private closedObserved = false;
  private readonly pendingErrors: unknown[] = [];
  private readonly pendingMessages: string[] = [];

  public constructor(private readonly socket: WebSocket) {
    socket.on('message', (data: RawData) => {
      const message = rawText(data);
      if (this.messageListeners.length === 0) this.pendingMessages.push(message);
      else for (const listener of this.messageListeners) listener(message);
    });
    socket.on('close', (code) => {
      this.closedObserved = true;
      this.closedCode = code;
      for (const listener of this.closeListeners) listener(code);
    });
    socket.on('error', (error) => {
      if (this.errorListeners.length === 0) this.pendingErrors.push(error);
      else for (const listener of this.errorListeners) listener(error);
    });
  }

  public close(): void {
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
  }

  public onClose(listener: (code?: number) => void): void {
    this.closeListeners.push(listener);
    if (this.closedObserved)
      queueMicrotask(() => {
        listener(this.closedCode);
      });
  }

  public onError(listener: (error: unknown) => void): void {
    this.errorListeners.push(listener);
    for (const error of this.pendingErrors.splice(0))
      queueMicrotask(() => {
        listener(error);
      });
  }

  public onMessage(listener: (message: string) => void): void {
    this.messageListeners.push(listener);
    for (const message of this.pendingMessages.splice(0)) listener(message);
  }

  public sendBinary(data: Uint8Array): Promise<void> {
    return this.send(data);
  }

  public sendText(data: string): Promise<void> {
    return this.send(data);
  }

  private send(data: Uint8Array | string): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return this.waitForNotOpenError();
    }
    return new Promise((resolve, reject) => {
      this.socket.send(data, (error) => {
        // ws@8 on Node 24 reports a successful send callback with null at runtime.
        const callbackError = error as Error | null | undefined;
        if (callbackError === undefined || callbackError === null) resolve();
        else if (this.socket.readyState !== WebSocket.OPEN) reject(this.notOpenError());
        else reject(classifyTencentTransportError(callbackError));
      });
    });
  }

  private notOpenError(): StreamingAsrError {
    return new StreamingAsrError('network', true, 'ASR_PROVIDER_UNAVAILABLE', undefined, {
      ...(isWebSocketCloseCode(this.closedCode) ? { closeCode: this.closedCode } : {}),
      errorClass: 'websocket_not_open',
      phase: 'websocket',
    });
  }

  private waitForNotOpenError(): Promise<never> {
    if (this.closedObserved) return Promise.reject(this.notOpenError());
    return new Promise((_, reject) => {
      const onClose = (): void => {
        clearTimeout(timer);
        reject(this.notOpenError());
      };
      const timer = setTimeout(() => {
        this.socket.removeListener('close', onClose);
        reject(this.notOpenError());
      }, 250);
      this.socket.once('close', onClose);
      if (this.closedObserved) {
        this.socket.removeListener('close', onClose);
        clearTimeout(timer);
        reject(this.notOpenError());
      }
    });
  }
}

export function classifyTencentTransportError(error: unknown): StreamingAsrError {
  const code = transportCode(error);
  const diagnostic = classifyTransportCode(code);
  return new StreamingAsrError('network', true, 'ASR_PROVIDER_UNAVAILABLE', undefined, diagnostic);
}

export function mapTencentWebSocketClose(code?: number): StreamingAsrError {
  return new StreamingAsrError('network', true, 'ASR_PROVIDER_UNAVAILABLE', undefined, {
    ...(isWebSocketCloseCode(code) ? { closeCode: code } : {}),
    errorClass: 'websocket_closed',
    phase: 'websocket',
  });
}

export function mapTencentError(code: number): StreamingAsrError {
  if (code === 4002) return new StreamingAsrError('auth', false, 'ASR_AUTH_FAILED', code);
  if (code === 4003) return new StreamingAsrError('engine', false, 'ASR_ENGINE_UNAVAILABLE', code);
  if (code === 4004 || code === 4005)
    return new StreamingAsrError('quota', false, 'ASR_QUOTA_EXHAUSTED', code);
  if (code === 4000 || code === 4006)
    return new StreamingAsrError('rate_limit', true, 'ASR_RATE_LIMITED', code);
  if (code === 4007) return new StreamingAsrError('audio', false, 'ASR_AUDIO_INVALID', code);
  if (code === 4008) return new StreamingAsrError('timeout', true, 'ASR_TIMEOUT', code);
  if ([4009, 5000, 5001, 5002].includes(code))
    return new StreamingAsrError('provider', true, 'ASR_PROVIDER_UNAVAILABLE', code);
  return new StreamingAsrError('protocol', false, 'ASR_PROTOCOL_INVALID', code);
}

function classifyTransportCode(code: string | null): StreamingAsrTransportDiagnostic {
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { errorClass: 'dns_resolution', phase: 'dns' };
  }
  if (code === 'ECONNREFUSED') return { errorClass: 'tcp_refused', phase: 'tcp' };
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return { errorClass: 'tcp_reset', phase: 'tcp' };
  }
  if (code === 'ETIMEDOUT' || code === 'ERR_SOCKET_CONNECTION_TIMEOUT') {
    return { errorClass: 'tcp_timeout', phase: 'tcp' };
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return { errorClass: 'network_unreachable', phase: 'tcp' };
  }
  if (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ) {
    return { errorClass: 'tls_certificate', phase: 'tls' };
  }
  if (code?.startsWith('ERR_TLS_') === true) {
    return { errorClass: 'tls_handshake', phase: 'tls' };
  }
  return { errorClass: 'unknown_transport', phase: 'tcp' };
}

function transportCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function safeHttpStatus(status: number | undefined): number | undefined {
  return Number.isInteger(status) && status !== undefined && status >= 100 && status <= 599
    ? status
    : undefined;
}

function isWebSocketCloseCode(code: number | undefined): code is number {
  return Number.isInteger(code) && code !== undefined && code >= 1_000 && code <= 4_999;
}

function mapTencentSentence(
  sessionId: string,
  attempt: TencentAttempt,
  message: TencentProviderMessage,
  sentence: TencentProviderSentence,
): StreamingAsrResult | null {
  const sentenceId = asInteger(sentence.sentence_id);
  const sentenceType = asInteger(sentence.sentence_type);
  const startMs = asInteger(sentence.start_time);
  const endMs = asInteger(sentence.end_time);
  if (
    sentenceId === null ||
    ![0, 1].includes(sentenceType ?? -1) ||
    startMs === null ||
    endMs === null ||
    typeof sentence.sentence !== 'string' ||
    endMs < startMs
  ) {
    return null;
  }
  const speakerId = asInteger(sentence.speaker_id);
  const namespaceHash = opaqueId(attempt.identity.providerNamespaceId);
  const messageHash =
    typeof message.message_id === 'string' ? opaqueId(message.message_id) : 'message-unknown';
  const kind = sentenceType === 1 ? 'final' : 'interim';
  const attemptOffsetMs = attempt.firstFrameStartMs ?? 0;
  return {
    ...attempt.identity,
    endMs: attemptOffsetMs + endMs,
    ingestKey:
      kind === 'final'
        ? `tencent-v2:${namespaceHash}:sentence:${String(sentenceId)}`
        : `tencent-v2:${namespaceHash}:interim:${String(sentenceId)}:${messageHash}`,
    kind,
    providerPayload: {
      message_id_hash: messageHash,
      sentence_id: sentenceId,
      sentence_type: sentenceType,
      speaker_id: speakerId === null || speakerId < 0 ? null : speakerId,
    },
    providerSegmentId: String(sentenceId),
    sessionId,
    source: 'realtime',
    speakerProviderId: speakerId === null || speakerId < 0 ? null : String(speakerId),
    startMs: attemptOffsetMs + startMs,
    text: sentence.sentence,
  };
}

function providerSentences(message: TencentProviderMessage): TencentProviderSentence[] {
  const candidates = [
    message.sentences,
    message.result?.speaker_sentences,
    message.result?.sentences,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return providerSentenceArray(candidate);
    if (!isRecord(candidate)) continue;
    if (Array.isArray(candidate.sentence_list)) {
      return providerSentenceArray(candidate.sentence_list);
    }
    if ('sentence_id' in candidate) return [candidate];
  }
  return [];
}

function providerSentenceArray(value: unknown[]): TencentProviderSentence[] {
  return value.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function normalizeError(
  error: unknown,
  fallback: 'network' | 'provider' | 'timeout',
): StreamingAsrError {
  if (error instanceof StreamingAsrError) return error;
  if (fallback === 'timeout') return new StreamingAsrError('timeout', true, 'ASR_TIMEOUT');
  return new StreamingAsrError(fallback, true, 'ASR_PROVIDER_UNAVAILABLE');
}

function opaqueId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function rawText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function abortSignalTriggered(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function withDeadline<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = (): void => {
    controller.abort();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new StreamingAsrError('timeout', true, 'ASR_TIMEOUT'));
        }, timeoutMs);
      }),
      ...(signal === undefined
        ? []
        : [
            new Promise<never>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  reject(new StreamingAsrError('cancelled', false, 'ASR_CANCELLED'));
                },
                { once: true },
              );
            }),
          ]),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted)
    return Promise.reject(new StreamingAsrError('cancelled', false, 'ASR_CANCELLED'));
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new StreamingAsrError('cancelled', false, 'ASR_CANCELLED'));
        },
        { once: true },
      );
    }),
  ]);
}
