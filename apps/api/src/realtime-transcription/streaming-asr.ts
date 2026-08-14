import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { InterviewWsAudioFramePayload } from '@elder-interview/contracts';

import type { NormalizedAsrResult } from '../transcription/transcription.types.js';

export type StreamingAsrSafeCode =
  | 'ASR_AUDIO_INVALID'
  | 'ASR_AUTH_FAILED'
  | 'ASR_CANCELLED'
  | 'ASR_ENGINE_UNAVAILABLE'
  | 'ASR_PROTOCOL_INVALID'
  | 'ASR_PROVIDER_UNAVAILABLE'
  | 'ASR_QUOTA_EXHAUSTED'
  | 'ASR_RATE_LIMITED'
  | 'ASR_TIMEOUT';

export type StreamingAsrErrorCategory =
  | 'audio'
  | 'auth'
  | 'cancelled'
  | 'engine'
  | 'network'
  | 'protocol'
  | 'provider'
  | 'quota'
  | 'rate_limit'
  | 'signature'
  | 'timeout';

export type StreamingAsrTransportErrorClass =
  | 'dns_resolution'
  | 'http_upgrade_rejected'
  | 'network_unreachable'
  | 'tcp_refused'
  | 'tcp_reset'
  | 'tcp_timeout'
  | 'tls_certificate'
  | 'tls_handshake'
  | 'unknown_transport'
  | 'websocket_closed'
  | 'websocket_not_open';

export interface StreamingAsrTransportDiagnostic {
  closeCode?: number;
  errorClass: StreamingAsrTransportErrorClass;
  httpStatus?: number;
  phase: 'dns' | 'tcp' | 'tls' | 'upgrade' | 'websocket';
}

export interface StreamingAsrAttemptIdentity {
  attemptId: string;
  providerNamespaceId: string;
  providerRequestId: string;
  speakerStreamId: string;
}

export type StreamingAsrResult = Omit<NormalizedAsrResult, 'speakerStreamId'> &
  StreamingAsrAttemptIdentity;

export interface StreamingAsrOpenContext {
  initialSpeakerStreamId: string;
  onAttempt: (identity: StreamingAsrAttemptIdentity) => Promise<void>;
  onResult: (result: StreamingAsrResult) => Promise<void>;
  onStatus?: (error: StreamingAsrError) => Promise<void> | void;
  rotateSpeakerStream: () => Promise<string>;
  sessionId: string;
  signal?: AbortSignal;
}

export interface StreamingFrameContext {
  frame: InterviewWsAudioFramePayload;
  sessionId: string;
  signal: AbortSignal;
}

export interface StreamingAcceptReceipt extends StreamingAsrAttemptIdentity {
  acceptedThroughSequence: number;
  scope: 'attempt';
}

export interface StreamingEndContext {
  lastAudioSequenceAccepted: number;
  sessionId: string;
  signal?: AbortSignal;
}

export interface AttemptDrainReceipt extends StreamingAsrAttemptIdentity {
  acceptedThroughSequence: number;
  completedAt: string;
  providerFinalObserved: true;
  resultsIngested: true;
  scope: 'attempt';
  terminalThroughSequence: number;
}

export type StreamingGapReason =
  | 'accepted_not_terminal'
  | 'cancelled_unaccounted_pcm'
  | 'capture_coverage_discontinuity'
  | 'drain_timeout_unaccounted_pcm'
  | 'evidence_lost'
  | 'provider_error_unaccounted_pcm'
  | 'ready_timeout_unaccounted_pcm';

export interface StreamingCoverageGap {
  backfillStatus: 'unbackfilled';
  endSequence: number | null;
  reason: StreamingGapReason;
  sourceAttemptId: string | null;
  startSequence: number | null;
}

export type SessionCaptureCompleteness =
  | {
      clearAuthority: 'HARDEN-ASR-001';
      completeCaptureCoverageProven: true;
      scope: 'session_capture';
      status: 'no_known_gap';
      stickyDegraded: false;
      unbackfilledGaps: readonly [];
    }
  | {
      clearAuthority: 'HARDEN-ASR-001';
      completeCaptureCoverageProven: false;
      scope: 'session_capture';
      status: 'known_unbackfilled_gap';
      stickyDegraded: true;
      unbackfilledGaps: readonly StreamingCoverageGap[];
    };

export abstract class StreamingAsrAdapter {
  public abstract open(context: StreamingAsrOpenContext): Promise<void>;

  public abstract accept(context: StreamingFrameContext): Promise<StreamingAcceptReceipt>;

  public abstract drainAndClose(context: StreamingEndContext): Promise<AttemptDrainReceipt>;

  public abstract cancel(sessionId: string): Promise<void>;

  public abstract markCoverageGap(
    sessionId: string,
    reason: StreamingGapReason,
    startSequence: number | null,
    endSequence: number | null,
  ): void;

  public abstract completeness(sessionId: string): SessionCaptureCompleteness;
}

interface FakeSession {
  acceptedThroughSequence: number;
  context: StreamingAsrOpenContext;
  gaps: StreamingCoverageGap[];
  identity: StreamingAsrAttemptIdentity;
  terminalThroughSequence: number;
}

@Injectable()
export class DeterministicStreamingAsrFake extends StreamingAsrAdapter {
  private readonly sessions = new Map<string, FakeSession>();

  public async open(context: StreamingAsrOpenContext): Promise<void> {
    const identity: StreamingAsrAttemptIdentity = {
      attemptId: randomUUID(),
      providerNamespaceId: `fixture:${randomUUID()}`,
      providerRequestId: `fixture-request:${randomUUID()}`,
      speakerStreamId: context.initialSpeakerStreamId,
    };
    this.sessions.set(context.sessionId, {
      acceptedThroughSequence: -1,
      context,
      gaps: [],
      identity,
      terminalThroughSequence: -1,
    });
    await context.onAttempt(identity);
  }

  public async accept({
    frame,
    sessionId,
  }: StreamingFrameContext): Promise<StreamingAcceptReceipt> {
    const session = this.sessions.get(sessionId);
    if (session === undefined)
      throw new StreamingAsrError('provider', false, 'ASR_PROVIDER_UNAVAILABLE');
    if (frame.sequence_no === 2) {
      throw new StreamingAsrError('provider', true, 'ASR_PROVIDER_UNAVAILABLE');
    }
    session.acceptedThroughSequence = frame.sequence_no;
    const common = {
      ...session.identity,
      sessionId,
      source: 'fixture' as const,
    };
    if (frame.sequence_no === 0) {
      await session.context.onResult({
        ...common,
        endMs: frame.end_ms,
        ingestKey: `ws-fixture:${frame.audio_stream_id}:hypothesis-1`,
        kind: 'interim',
        startMs: frame.start_ms,
        text: '这是一段虚构的实时转录中间态。',
      });
      await session.context.onResult({
        ...common,
        endMs: frame.end_ms,
        ingestKey: `ws-fixture:${frame.audio_stream_id}:speaker-1`,
        kind: 'final',
        providerPayload: { fixture: 'deterministic-streaming-v2' },
        providerSegmentId: 'fixture-speaker-1',
        speakerProviderId: 'speaker_1',
        startMs: frame.start_ms,
        text: '本地测试说话人一。',
      });
    } else if (frame.sequence_no === 1) {
      await session.context.onResult({
        ...common,
        endMs: frame.end_ms,
        ingestKey: `ws-fixture:${frame.audio_stream_id}:speaker-2`,
        kind: 'final',
        providerPayload: { fixture: 'deterministic-streaming-v2' },
        providerSegmentId: 'fixture-speaker-2',
        speakerProviderId: 'speaker_2',
        startMs: frame.start_ms,
        text: '这是一段完全虚构的实时转录。',
      });
    }
    session.terminalThroughSequence = frame.sequence_no;
    return {
      ...session.identity,
      acceptedThroughSequence: frame.sequence_no,
      scope: 'attempt',
    };
  }

  public drainAndClose({ sessionId }: StreamingEndContext): Promise<AttemptDrainReceipt> {
    const session = this.sessions.get(sessionId);
    if (session === undefined)
      return Promise.reject(new StreamingAsrError('provider', false, 'ASR_PROVIDER_UNAVAILABLE'));
    if (
      session.gaps.length > 0 ||
      session.terminalThroughSequence < session.acceptedThroughSequence
    ) {
      return Promise.reject(new StreamingAsrError('provider', false, 'ASR_PROVIDER_UNAVAILABLE'));
    }
    this.sessions.delete(sessionId);
    return Promise.resolve({
      ...session.identity,
      acceptedThroughSequence: session.acceptedThroughSequence,
      completedAt: new Date().toISOString(),
      providerFinalObserved: true,
      resultsIngested: true,
      scope: 'attempt',
      terminalThroughSequence: session.terminalThroughSequence,
    });
  }

  public cancel(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
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
    session.gaps.push({
      backfillStatus: 'unbackfilled',
      endSequence,
      reason,
      sourceAttemptId: session.identity.attemptId,
      startSequence,
    });
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
}

export class StreamingAsrError extends Error {
  public constructor(
    public readonly category: StreamingAsrErrorCategory,
    public readonly retryable: boolean,
    public readonly safeCode: StreamingAsrSafeCode,
    public readonly providerCode?: number,
    public readonly transportDiagnostic?: Readonly<StreamingAsrTransportDiagnostic>,
  ) {
    super(safeCode);
    this.name = 'StreamingAsrError';
  }
}
