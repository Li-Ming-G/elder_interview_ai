import { Injectable } from '@nestjs/common';
import type { InterviewWsAudioFramePayload } from '@elder-interview/contracts';

import type { NormalizedAsrResult } from '../transcription/transcription.types.js';

export interface StreamingFrameContext {
  frame: InterviewWsAudioFramePayload;
  sessionId: string;
  signal: AbortSignal;
}

export interface StreamingEndContext {
  ingestFinal: (result: NormalizedAsrResult) => Promise<void>;
  lastAudioSequenceAccepted: number;
  sessionId: string;
}

export abstract class StreamingAsrAdapter {
  public abstract accept(context: StreamingFrameContext): Promise<readonly NormalizedAsrResult[]>;

  public abstract drainAndClose(context: StreamingEndContext): Promise<void>;
}

@Injectable()
export class DeterministicStreamingAsrFake extends StreamingAsrAdapter {
  public drainAndClose(): Promise<void> {
    return Promise.resolve();
  }

  public accept({
    frame,
    sessionId,
  }: StreamingFrameContext): Promise<readonly NormalizedAsrResult[]> {
    if (frame.sequence_no === 2) {
      return Promise.reject(new StreamingAsrUnavailableError());
    }
    if (frame.sequence_no === 0) {
      return Promise.resolve([
        {
          endMs: frame.end_ms,
          ingestKey: `ws-fixture:${frame.audio_stream_id}:hypothesis-1`,
          kind: 'interim',
          sessionId,
          source: 'fixture',
          startMs: frame.start_ms,
          text: '这是一段虚构的实时转录中间态。',
        },
        {
          endMs: frame.end_ms,
          ingestKey: `ws-fixture:${frame.audio_stream_id}:speaker-1`,
          kind: 'final',
          providerPayload: { fixture: 'deterministic-streaming-v2' },
          providerSegmentId: 'fixture-speaker-1',
          sessionId,
          source: 'fixture',
          speakerProviderId: 'speaker_1',
          startMs: frame.start_ms,
          text: '本地测试说话人一。',
        },
      ]);
    }
    if (frame.sequence_no === 1) {
      return Promise.resolve([
        {
          endMs: frame.end_ms,
          ingestKey: `ws-fixture:${frame.audio_stream_id}:speaker-2`,
          kind: 'final',
          providerPayload: { fixture: 'deterministic-streaming-v2' },
          providerSegmentId: 'fixture-speaker-2',
          sessionId,
          source: 'fixture',
          speakerProviderId: 'speaker_2',
          startMs: frame.start_ms,
          text: '这是一段完全虚构的实时转录。',
        },
      ]);
    }
    return Promise.resolve([]);
  }
}

@Injectable()
export class UnavailableStreamingAsrAdapter extends StreamingAsrAdapter {
  public accept(): Promise<never> {
    return Promise.reject(new StreamingAsrUnavailableError());
  }

  public drainAndClose(): Promise<never> {
    return Promise.reject(new StreamingAsrUnavailableError());
  }
}

export class StreamingAsrUnavailableError extends Error {
  public constructor() {
    super('ASR_UNAVAILABLE');
  }
}
