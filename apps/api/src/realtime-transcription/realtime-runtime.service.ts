import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  InterviewWsAudioFramePayload,
  InterviewWsServerEnvelope,
  InterviewWsServerType,
} from '@elder-interview/contracts';

const MAX_EVENTS = 512;
const MAX_AGE_MS = 300_000;

export interface StoredEvent {
  createdAt: number;
  envelope: InterviewWsServerEnvelope<InterviewWsServerType, unknown>;
}

interface FrameEvidence {
  endMs: number;
  pcmSha256: string;
  startMs: number;
}

export interface SessionRuntime {
  audioStreamId: string;
  eventStreamId: string;
  events: StoredEvent[];
  frames: Map<number, FrameEvidence>;
  highestAudioSequenceAcked: number;
  highestEventSequenceAcked: number;
  lastTouchedAt: number;
  nextServerSequence: number;
  pendingBytes: number;
  pendingFrames: number;
  producer: object | null;
  producerLease: number;
  publishedFinalSegmentIds: Set<string>;
  sessionId: string;
  timelineOffsetMs: number;
}

@Injectable()
export class RealtimeRuntimeService {
  private readonly sessions = new Map<string, SessionRuntime>();

  public create(sessionId: string, audioStreamId: string, timelineOffsetMs = 0): SessionRuntime {
    const existing = this.sessions.get(sessionId);
    if (
      existing !== undefined &&
      Date.now() - existing.lastTouchedAt <= MAX_AGE_MS &&
      (existing.audioStreamId === audioStreamId || existing.producer !== null)
    )
      return existing;
    const runtime: SessionRuntime = {
      audioStreamId,
      eventStreamId: randomUUID(),
      events: [],
      frames: new Map(),
      highestAudioSequenceAcked: -1,
      highestEventSequenceAcked: -1,
      lastTouchedAt: Date.now(),
      nextServerSequence: 0,
      pendingBytes: 0,
      pendingFrames: 0,
      producer: null,
      producerLease: 0,
      publishedFinalSegmentIds: new Set(),
      sessionId,
      timelineOffsetMs,
    };
    this.sessions.set(sessionId, runtime);
    return runtime;
  }

  public find(sessionId: string): SessionRuntime | null {
    const runtime = this.sessions.get(sessionId);
    if (runtime === undefined || Date.now() - runtime.lastTouchedAt > MAX_AGE_MS) return null;
    this.prune(runtime);
    return runtime;
  }

  public recover(
    sessionId: string,
    audioStreamId: string,
    eventStreamId: string,
  ): SessionRuntime | null {
    const runtime = this.sessions.get(sessionId);
    if (
      runtime === undefined ||
      runtime.audioStreamId !== audioStreamId ||
      runtime.eventStreamId !== eventStreamId ||
      Date.now() - runtime.lastTouchedAt > MAX_AGE_MS
    )
      return null;
    this.prune(runtime);
    return runtime;
  }

  public append<TType extends InterviewWsServerType, TPayload>(
    runtime: SessionRuntime,
    type: TType,
    payload: TPayload,
  ): InterviewWsServerEnvelope<TType, TPayload> {
    const envelope: InterviewWsServerEnvelope<TType, TPayload> = {
      event_id: randomUUID(),
      event_stream_id: runtime.eventStreamId,
      payload,
      schema_version: '1.0',
      server_sequence: runtime.nextServerSequence,
      session_id: runtime.sessionId,
      timestamp: new Date().toISOString(),
      type,
    };
    runtime.nextServerSequence += 1;
    runtime.lastTouchedAt = Date.now();
    runtime.events.push({ createdAt: runtime.lastTouchedAt, envelope });
    this.prune(runtime);
    return envelope;
  }

  public replayAfter(runtime: SessionRuntime, sequence: number): readonly StoredEvent[] | null {
    this.prune(runtime);
    const earliest = runtime.events[0]?.envelope.server_sequence ?? runtime.nextServerSequence;
    if (sequence < earliest - 1 || sequence >= runtime.nextServerSequence) return null;
    return runtime.events.filter(({ envelope }) => envelope.server_sequence > sequence);
  }

  public frameMatches(
    runtime: SessionRuntime,
    frame: InterviewWsAudioFramePayload,
  ): boolean | null {
    const existing = runtime.frames.get(frame.sequence_no);
    if (existing === undefined) return null;
    return (
      existing.pcmSha256 === frame.pcm_sha256 &&
      existing.startMs === frame.start_ms &&
      existing.endMs === frame.end_ms
    );
  }

  public recordFrame(runtime: SessionRuntime, frame: InterviewWsAudioFramePayload): void {
    runtime.frames.set(frame.sequence_no, {
      endMs: frame.end_ms,
      pcmSha256: frame.pcm_sha256,
      startMs: frame.start_ms,
    });
    runtime.highestAudioSequenceAcked = frame.sequence_no;
    runtime.lastTouchedAt = Date.now();
  }

  public release(runtime: SessionRuntime, client: object): void {
    if (runtime.producer === client) {
      runtime.producer = null;
      runtime.producerLease += 1;
    }
    runtime.lastTouchedAt = Date.now();
  }

  public claim(runtime: SessionRuntime, client: object): number {
    runtime.producer = client;
    runtime.producerLease += 1;
    runtime.lastTouchedAt = Date.now();
    return runtime.producerLease;
  }

  public isProducerLeaseCurrent(runtime: SessionRuntime, client: object, lease: number): boolean {
    return runtime.producer === client && runtime.producerLease === lease;
  }

  public interruptCapture(sessionId: string, audioStreamId: string): boolean {
    const runtime = this.sessions.get(sessionId);
    if (runtime === undefined || runtime.audioStreamId !== audioStreamId) return false;
    runtime.producer = null;
    runtime.producerLease += 1;
    runtime.lastTouchedAt = Date.now();
    return true;
  }

  public interruptSession(sessionId: string): void {
    const runtime = this.sessions.get(sessionId);
    if (runtime === undefined) return;
    runtime.producer = null;
    runtime.producerLease += 1;
    runtime.lastTouchedAt = Date.now();
  }

  private prune(runtime: SessionRuntime): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    runtime.events = runtime.events
      .filter(({ createdAt }) => createdAt >= cutoff)
      .slice(-MAX_EVENTS);
  }
}
