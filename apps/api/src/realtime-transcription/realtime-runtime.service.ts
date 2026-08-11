import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  InterviewWsAudioFramePayload,
  InterviewWsServerEnvelope,
  InterviewWsServerType,
  SpeakerCalibrationSnapshot,
  SuggestionPresentationChangedPayload,
} from '@elder-interview/contracts';
import { PrismaService } from '../database/prisma.service.js';

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
  captureGenerationId: string;
  eventStreamId: string;
  events: StoredEvent[];
  frames: Map<number, FrameEvidence>;
  highestAudioSequenceAcked: number;
  highestEventSequenceAcked: number;
  lastTouchedAt: number;
  nextServerSequence: number;
  nextAudioSequence: number;
  pendingBytes: number;
  pendingFrames: number;
  producer: object | null;
  producerLease: number;
  publishedFinalSegmentIds: Set<string>;
  publishedCalibrationLabels: Set<string>;
  sessionId: string;
  speakerStreamId: string;
  timelineOffsetMs: number;
  queue: CausalQueue;
  subscriber: ((event: InterviewWsServerEnvelope<InterviewWsServerType, unknown>) => void) | null;
  notificationAuthorizer: (() => Promise<boolean>) | null;
}

export interface FinalizedTranscriptNotice {
  segmentId: string;
  sessionId: string;
}

export class CausalQueue {
  private tail: Promise<void> = Promise.resolve();

  public enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public enqueueBefore<T>(deadline: number, work: (remainingMs: number) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let started = false;
      const timer = setTimeout(
        () => {
          if (!started && !settled) {
            settled = true;
            reject(new CausalQueueTimeoutError());
          }
        },
        Math.max(0, deadline - Date.now()),
      );
      void this.enqueue(async () => {
        started = true;
        clearTimeout(timer);
        if (settled) throw new CausalQueueTimeoutError();
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new CausalQueueTimeoutError();
        return work(remaining);
      }).then(
        (value) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            reject(error instanceof Error ? error : new Error('Causal queue failed'));
          }
        },
      );
    });
  }
}

export class CausalQueueTimeoutError extends Error {}

@Injectable()
export class RealtimeRuntimeService {
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly finalizedSubscribers = new Set<(notice: FinalizedTranscriptNotice) => void>();

  public constructor(private readonly prisma?: PrismaService) {}

  public create(
    sessionId: string,
    audioStreamId: string,
    timelineOffsetMs?: number,
  ): SessionRuntime;
  public create(
    sessionId: string,
    audioStreamId: string,
    captureGenerationId: string,
    queue?: CausalQueue,
    timelineOffsetMs?: number,
  ): Promise<SessionRuntime>;
  public create(
    sessionId: string,
    audioStreamId: string,
    captureGenerationIdOrTimeline: string | number = randomUUID(),
    queue = new CausalQueue(),
    timelineOffsetMs = 0,
  ): Promise<SessionRuntime> | SessionRuntime {
    const captureGenerationId =
      typeof captureGenerationIdOrTimeline === 'string'
        ? captureGenerationIdOrTimeline
        : randomUUID();
    const resolvedTimelineOffsetMs =
      typeof captureGenerationIdOrTimeline === 'number'
        ? captureGenerationIdOrTimeline
        : timelineOffsetMs;
    const existing = this.sessions.get(sessionId);
    if (
      existing !== undefined &&
      Date.now() - existing.lastTouchedAt <= MAX_AGE_MS &&
      (existing.audioStreamId === audioStreamId || existing.producer !== null)
    )
      return existing;
    if (this.prisma === undefined) {
      return this.buildRuntime(
        sessionId,
        audioStreamId,
        randomUUID(),
        captureGenerationId,
        queue,
        resolvedTimelineOffsetMs,
      );
    }
    return this.prisma
      .$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`;
        await transaction.speakerStream.updateMany({
          data: { closedAt: new Date(), status: 'closed' },
          where: { sessionId, status: 'active' },
        });
        return transaction.speakerStream.create({
          data: { captureGenerationId, sessionId },
          select: { id: true },
        });
      })
      .then((speakerStream) =>
        this.buildRuntime(
          sessionId,
          audioStreamId,
          speakerStream.id,
          captureGenerationId,
          queue,
          resolvedTimelineOffsetMs,
        ),
      );
  }

  private buildRuntime(
    sessionId: string,
    audioStreamId: string,
    speakerStreamId: string,
    captureGenerationId: string,
    queue: CausalQueue,
    timelineOffsetMs: number,
  ): SessionRuntime {
    const runtime: SessionRuntime = {
      audioStreamId,
      captureGenerationId,
      eventStreamId: randomUUID(),
      events: [],
      frames: new Map(),
      highestAudioSequenceAcked: -1,
      highestEventSequenceAcked: -1,
      lastTouchedAt: Date.now(),
      nextServerSequence: 0,
      nextAudioSequence: 0,
      pendingBytes: 0,
      pendingFrames: 0,
      producer: null,
      producerLease: 0,
      publishedFinalSegmentIds: new Set(),
      publishedCalibrationLabels: new Set(),
      queue,
      sessionId,
      speakerStreamId,
      subscriber: null,
      notificationAuthorizer: null,
      timelineOffsetMs,
    };
    this.sessions.set(sessionId, runtime);
    return runtime;
  }

  public enqueue<T>(runtime: SessionRuntime, work: () => Promise<T>): Promise<T> {
    return runtime.queue.enqueue(work);
  }

  public subscribe(
    runtime: SessionRuntime,
    subscriber: (event: InterviewWsServerEnvelope<InterviewWsServerType, unknown>) => void,
  ): void {
    runtime.subscriber = subscriber;
  }

  public authorizeNotifications(runtime: SessionRuntime, authorizer: () => Promise<boolean>): void {
    runtime.notificationAuthorizer = authorizer;
  }

  public onFinalized(subscriber: (notice: FinalizedTranscriptNotice) => void): () => void {
    this.finalizedSubscribers.add(subscriber);
    return () => {
      this.finalizedSubscribers.delete(subscriber);
    };
  }

  public notifyFinalized(notice: FinalizedTranscriptNotice): void {
    for (const subscriber of this.finalizedSubscribers) {
      try {
        subscriber(notice);
      } catch {
        // Suggestion orchestration is isolated from the recording/transcription path.
      }
    }
  }

  public async publishSuggestionChanged(
    sessionId: string,
    payload: SuggestionPresentationChangedPayload,
  ): Promise<void> {
    const runtime = this.find(sessionId);
    if (runtime === null || runtime.subscriber === null) return;
    if (runtime.notificationAuthorizer === null || !(await runtime.notificationAuthorizer())) {
      return;
    }
    const envelope: InterviewWsServerEnvelope<
      'suggestion.presentation.changed',
      SuggestionPresentationChangedPayload
    > = {
      event_id: randomUUID(),
      event_stream_id: runtime.eventStreamId,
      payload,
      schema_version: '1.2',
      server_sequence: runtime.nextServerSequence,
      session_id: runtime.sessionId,
      timestamp: new Date().toISOString(),
      type: 'suggestion.presentation.changed',
    };
    runtime.nextServerSequence += 1;
    runtime.lastTouchedAt = Date.now();
    runtime.events.push({ createdAt: runtime.lastTouchedAt, envelope });
    this.prune(runtime);
    try {
      runtime.subscriber(envelope);
    } catch {
      runtime.subscriber = null;
    }
  }

  public publishCalibration(runtime: SessionRuntime, snapshot: SpeakerCalibrationSnapshot): void {
    const event = this.append(runtime, 'speaker.calibration.updated', snapshot);
    try {
      runtime.subscriber?.(event);
    } catch {
      // The canonical event is already in the replay window. A failed live socket write must not
      // roll back the committed marker or let delivery failure create a second event on retry.
      runtime.subscriber = null;
      runtime.notificationAuthorizer = null;
    }
  }

  public enqueueMarker<T>(
    sessionId: string,
    speakerStreamId: string,
    deadline: number,
    work: (runtime: SessionRuntime, remainingMs: number) => Promise<T>,
  ): Promise<T> {
    const runtime = this.find(sessionId);
    if (
      runtime === null ||
      runtime.speakerStreamId !== speakerStreamId ||
      runtime.producer === null
    ) {
      throw new CausalQueueUnavailableError();
    }
    return runtime.queue.enqueueBefore(deadline, async (remainingMs) => {
      if (
        runtime.producer === null ||
        runtime.speakerStreamId !== speakerStreamId ||
        this.sessions.get(sessionId) !== runtime
      ) {
        throw new CausalQueueUnavailableError();
      }
      return work(runtime, remainingMs);
    });
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
      schema_version: '1.1',
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
    runtime.nextAudioSequence = frame.sequence_no + 1;
    runtime.lastTouchedAt = Date.now();
  }

  public release(runtime: SessionRuntime, client: object): void {
    if (runtime.producer === client) {
      runtime.producer = null;
      runtime.producerLease += 1;
      runtime.subscriber = null;
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

export class CausalQueueUnavailableError extends Error {}
