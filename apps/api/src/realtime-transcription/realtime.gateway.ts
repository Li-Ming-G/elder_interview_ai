import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import type {
  InterviewWsAudioFramePayload,
  InterviewWsClientMessage,
  InterviewWsServerEnvelope,
  InterviewWsServerType,
} from '@elder-interview/contracts';
import type { RawData, WebSocket } from 'ws';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { TranscriptIngestionService } from '../transcription/transcript-ingestion.service.js';
import { SpeakerCalibrationSnapshotService } from '../transcription/speaker-calibration-snapshot.service.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import { mapAsrResultToSessionTimeline } from './asr-timeline.js';
import { CapturePcmEvidenceService } from './capture-pcm-evidence.service.js';
import { decodeClientMessage, RealtimeCodecError } from './realtime-codec.js';
import { RealtimeAccessService } from './realtime-access.service.js';
import { WS_AUTH, type AuthenticatedUpgradeRequest } from './realtime-auth.js';
import {
  CausalQueue,
  RealtimeRuntimeService,
  type SessionRuntime,
} from './realtime-runtime.service.js';
import { StreamingAsrAdapter, StreamingAsrUnavailableError } from './streaming-asr.js';

const NIL_UUID = '00000000-0000-4000-8000-000000000000';

interface ConnectionState {
  acceptingMessages: boolean;
  actor: AuthPrincipal;
  closed: boolean;
  joined: boolean;
  lastMessageAt: number;
  queuedAudioBytes: number;
  queuedAudioFrames: number;
  runtime: SessionRuntime | null;
  queue: CausalQueue;
  sessionId: string | null;
  sessionToken: string;
}

@WebSocketGateway({ path: '/ws/interviews' })
export class RealtimeTranscriptionGateway {
  private readonly connections = new WeakMap<WebSocket, ConnectionState>();

  public constructor(
    private readonly access: RealtimeAccessService,
    private readonly runtimes: RealtimeRuntimeService,
    private readonly adapter: StreamingAsrAdapter,
    private readonly ingestion: TranscriptIngestionService,
    private readonly captureEvidence: CapturePcmEvidenceService,
    private readonly calibrationSnapshots: SpeakerCalibrationSnapshotService,
  ) {}

  public handleConnection(client: WebSocket, request: AuthenticatedUpgradeRequest): void {
    const auth = request[WS_AUTH];
    if (auth === undefined) {
      client.close(4401, 'AUTH_REQUIRED');
      return;
    }
    const state: ConnectionState = {
      acceptingMessages: true,
      actor: auth.principal,
      closed: false,
      joined: false,
      lastMessageAt: Date.now(),
      queuedAudioBytes: 0,
      queuedAudioFrames: 0,
      runtime: null,
      queue: new CausalQueue(),
      sessionId: null,
      sessionToken: auth.sessionToken,
    };
    this.connections.set(client, state);
    const joinTimer = setTimeout(() => {
      if (!state.joined) this.fail(client, state, 'JOIN_TIMEOUT', 4408);
    }, 5_000);
    const heartbeatTimer = setInterval(() => {
      if (Date.now() - state.lastMessageAt > 45_000)
        this.fail(client, state, 'HEARTBEAT_TIMEOUT', 4408);
    }, 5_000);
    client.once('close', () => {
      state.acceptingMessages = false;
      state.closed = true;
      clearTimeout(joinTimer);
      clearInterval(heartbeatTimer);
      const runtime = state.runtime;
      if (runtime !== null) {
        this.runtimes.release(runtime, client);
      }
    });
    client.on('message', (data, isBinary) => {
      if (!state.acceptingMessages) return;
      const buffer = toBuffer(data);
      let message: InterviewWsClientMessage | null = null;
      let failure: unknown = null;
      if (isBinary) failure = new RealtimeCodecError('INVALID_WS_MESSAGE');
      else {
        try {
          message = decodeClientMessage(buffer);
        } catch (error) {
          failure = error;
        }
      }
      if (failure !== null) state.acceptingMessages = false;
      const isAudioFrame = message?.type === 'audio.frame';
      if (isAudioFrame) {
        if (state.queuedAudioFrames >= 20 || state.queuedAudioBytes + 3200 > 64_000) {
          state.acceptingMessages = false;
          failure = new BackpressureError();
          message = null;
        } else {
          state.queuedAudioFrames += 1;
          state.queuedAudioBytes += 3200;
        }
      }
      void state.queue
        .enqueue(async () => {
          if (state.closed || client.readyState !== client.OPEN) return;
          if (failure !== null) {
            throw failure instanceof Error ? failure : new Error('WebSocket message failed');
          }
          await this.onMessage(client, state, message as InterviewWsClientMessage);
        })
        .catch((error: unknown) => {
          this.onFailure(client, state, error);
        });
      if (isAudioFrame && message !== null) {
        void state.queue.enqueue(() => {
          state.queuedAudioFrames -= 1;
          state.queuedAudioBytes -= 3200;
        });
      }
    });
  }

  private async onMessage(
    client: WebSocket,
    state: ConnectionState,
    message: InterviewWsClientMessage,
  ): Promise<void> {
    state.lastMessageAt = Date.now();
    if (!state.joined) {
      if (message.type !== 'session.join') throw new RealtimeCodecError('INVALID_WS_MESSAGE');
      await this.join(client, state, message);
      return;
    }
    if (
      message.type === 'session.join' ||
      message.session_id !== state.sessionId ||
      state.runtime === null
    ) {
      throw new RealtimeCodecError('INVALID_WS_MESSAGE');
    }
    state.actor = await this.access.authenticate(state.sessionToken, state.actor.id);
    if (message.type === 'audio.frame') {
      await this.frame(client, state, message.payload);
      return;
    }
    const mode = await this.access.assertActiveConnection(state.actor, state.runtime.sessionId);
    if (mode === 'resume-only') this.runtimes.release(state.runtime, client);
    if (message.type === 'event.ack') this.eventAck(state.runtime, message.payload.server_sequence);
    else this.sendStored(client, this.runtimes.append(state.runtime, 'heartbeat.ack', {}));
  }

  private async join(
    client: WebSocket,
    state: ConnectionState,
    message: Extract<InterviewWsClientMessage, { type: 'session.join' }>,
  ): Promise<void> {
    state.sessionId = message.session_id;
    state.actor = await this.access.authenticate(state.sessionToken, state.actor.id);
    const joinAccess = await this.access.assertJoin(
      state.actor,
      message.session_id,
      message.payload.csrf_token,
      message.payload.audio_stream_id,
    );
    const { mode } = joinAccess;
    const eventStreamId = message.payload.event_stream_id;
    const resumeAfterServerSequence = message.payload.resume_after_server_sequence;
    const resumeRequested = eventStreamId !== undefined && resumeAfterServerSequence !== undefined;
    if (mode === 'resume-only' && !resumeRequested) {
      this.fail(client, state, 'SESSION_NOT_STREAMABLE', 4408);
      return;
    }

    let runtime: SessionRuntime;
    let replay: readonly { envelope: InterviewWsServerEnvelope<InterviewWsServerType, unknown> }[] =
      [];
    if (resumeRequested) {
      const recoveredRuntime = this.runtimes.recover(
        message.session_id,
        message.payload.audio_stream_id,
        eventStreamId,
      );
      if (recoveredRuntime === null) {
        this.fail(client, state, 'RESUME_WINDOW_EXPIRED', 4450, true);
        return;
      }
      runtime = recoveredRuntime;
      const recovered = this.runtimes.replayAfter(runtime, resumeAfterServerSequence);
      if (recovered === null) {
        this.fail(client, state, 'RESUME_WINDOW_EXPIRED', 4450, true);
        return;
      }
      replay = recovered;
    } else {
      const existing = this.runtimes.find(message.session_id);
      if (existing !== null) {
        if (existing.producer !== null) {
          this.fail(client, state, 'SESSION_STREAM_ALREADY_ACTIVE', 4408);
          return;
        }
        if (existing.audioStreamId === message.payload.audio_stream_id) {
          this.fail(client, state, 'RESUME_WINDOW_EXPIRED', 4450, true);
          return;
        }
      }
      if (joinAccess.timelineOffsetMs === null) {
        throw new Error('Capture timeline is unavailable');
      }
      if (joinAccess.captureGenerationId === null) {
        throw new Error('Capture generation is unavailable');
      }
      runtime = await this.runtimes.create(
        message.session_id,
        message.payload.audio_stream_id,
        joinAccess.captureGenerationId,
        state.queue,
        joinAccess.timelineOffsetMs,
      );
    }
    if (mode === 'produce') {
      if (runtime.producer !== null && runtime.producer !== client) {
        const previousProducer = runtime.producer as WebSocket;
        if (previousProducer.readyState === previousProducer.OPEN) {
          this.fail(client, state, 'SESSION_STREAM_ALREADY_ACTIVE', 4408);
          return;
        }
        this.runtimes.release(runtime, previousProducer);
      }
      this.runtimes.claim(runtime, client);
      this.runtimes.subscribe(runtime, (event) => {
        this.sendStored(client, event);
      });
      this.runtimes.authorizeNotifications(runtime, async () => {
        try {
          state.actor = await this.access.authenticate(state.sessionToken, state.actor.id);
          await this.access.assertActiveConnection(state.actor, runtime.sessionId);
          return runtime.producer === client && client.readyState === client.OPEN;
        } catch {
          return false;
        }
      });
      await this.access.assertActiveConnection(state.actor, runtime.sessionId);
      if (runtime.producer !== client) {
        this.fail(client, state, 'FORBIDDEN', 4403);
        return;
      }
    }
    state.joined = true;
    state.runtime = runtime;
    state.queue = runtime.queue;
    for (const stored of replay) this.sendStored(client, stored.envelope);
    const calibration = await this.calibrationSnapshots.get(runtime.sessionId);
    this.sendStored(
      client,
      this.runtimes.append(runtime, 'session.ready', {
        audio_stream_id: runtime.audioStreamId,
        speaker_calibration: calibration,
        highest_audio_sequence_acked: runtime.highestAudioSequenceAcked,
        resume_window_events: 512,
        resume_window_seconds: 300,
        resumed: resumeRequested,
      }),
    );
    if (!resumeRequested) {
      this.sendStored(
        client,
        this.runtimes.append(runtime, 'speaker.calibration.updated', calibration),
      );
    }
  }

  private async frame(
    client: WebSocket,
    state: ConnectionState,
    frame: InterviewWsAudioFramePayload,
  ): Promise<void> {
    const runtime = state.runtime;
    if (runtime === null) throw new RealtimeCodecError('INVALID_WS_MESSAGE');
    await this.access.assertFrame(state.actor, runtime.sessionId);
    if (runtime.producer !== client || frame.audio_stream_id !== runtime.audioStreamId) {
      this.fail(client, state, 'SESSION_STREAM_ALREADY_ACTIVE', 4408);
      return;
    }
    const producerLease = runtime.producerLease;
    const replay = this.runtimes.frameMatches(runtime, frame);
    if (replay === true) {
      this.audioAck(client, runtime);
      return;
    }
    if (replay === false) {
      this.fail(client, state, 'AUDIO_FRAME_CONFLICT', 4409);
      return;
    }
    if (frame.sequence_no !== runtime.nextAudioSequence) {
      this.fail(client, state, 'AUDIO_FRAME_GAP', 4409);
      return;
    }
    if (runtime.pendingFrames >= 20 || runtime.pendingBytes + 3200 > 64_000) {
      this.fail(client, state, 'BACKPRESSURE_LIMIT', 4429);
      return;
    }
    runtime.pendingFrames += 1;
    runtime.pendingBytes += 3200;
    try {
      const results = await this.captureEvidence.acceptAndPersist(
        runtime.sessionId,
        runtime.audioStreamId,
        (signal) => this.adapter.accept({ frame, sessionId: runtime.sessionId, signal }),
      );
      if (!this.runtimes.isProducerLeaseCurrent(runtime, client, producerLease)) return;
      for (const result of results) {
        const sessionTimelineResult = {
          ...mapAsrResultToSessionTimeline(result, runtime.timelineOffsetMs),
          speakerStreamId: runtime.speakerStreamId,
        };
        const persisted = await this.ingestion.ingest(sessionTimelineResult);
        if (!this.runtimes.isProducerLeaseCurrent(runtime, client, producerLease)) return;
        if (persisted.kind === 'interim') {
          this.sendStored(
            client,
            this.runtimes.append(runtime, 'asr.interim', {
              content_kind: persisted.contentKind,
              end_ms: sessionTimelineResult.endMs,
              finality: 'interim',
              hypothesis_id: sessionTimelineResult.ingestKey,
              revision: frame.sequence_no,
              start_ms: sessionTimelineResult.startMs,
              text: sessionTimelineResult.text,
            }),
          );
        } else if (!runtime.publishedFinalSegmentIds.has(persisted.segment.id)) {
          runtime.publishedFinalSegmentIds.add(persisted.segment.id);
          const speakerRole = projectTrustedSpeakerRole(persisted.segment);
          this.sendStored(
            client,
            this.runtimes.append(runtime, 'asr.final', {
              end_ms: persisted.segment.endMs,
              finality: 'final',
              segment_id: persisted.segment.id,
              effective_speaker_role: speakerRole.effectiveSpeakerRole,
              speaker_provider_id: persisted.segment.speakerProviderId,
              speaker_role: persisted.segment.originalSpeakerRole,
              speaker_role_authority: persisted.segment.originalRoleAuthority,
              speaker_role_revision: persisted.segment.speakerRoleRevision,
              speaker_stream_id: persisted.segment.speakerStreamId,
              content_kind: persisted.segment.contentKind,
              start_ms: persisted.segment.startMs,
              text: persisted.segment.originalText,
              trusted_effective_speaker_role: speakerRole.trustedEffectiveSpeakerRole,
              trusted_speaker_role: speakerRole.trustedEffectiveSpeakerRole,
            }),
          );
          if (persisted.segment.contentKind === 'conversation') {
            this.runtimes.notifyFinalized({
              segmentId: persisted.segment.id,
              sessionId: runtime.sessionId,
            });
          }
          const label = persisted.segment.speakerProviderId;
          if (
            label !== null &&
            persisted.segment.contentKind === 'speaker_calibration' &&
            !runtime.publishedCalibrationLabels.has(label)
          ) {
            runtime.publishedCalibrationLabels.add(label);
            this.sendStored(
              client,
              this.runtimes.append(
                runtime,
                'speaker.calibration.updated',
                await this.calibrationSnapshots.get(runtime.sessionId),
              ),
            );
          }
        }
      }
      if (!this.runtimes.isProducerLeaseCurrent(runtime, client, producerLease)) return;
      this.runtimes.recordFrame(runtime, frame);
      this.audioAck(client, runtime);
    } catch (error) {
      if (error instanceof StreamingAsrUnavailableError) {
        this.sendStored(
          client,
          this.runtimes.append(runtime, 'asr.status', {
            code: 'ASR_UNAVAILABLE',
            status: 'unavailable',
          }),
        );
        this.fail(client, state, 'ASR_UNAVAILABLE', 4503);
        return;
      }
      throw error;
    } finally {
      runtime.pendingFrames -= 1;
      runtime.pendingBytes -= 3200;
    }
  }

  private audioAck(client: WebSocket, runtime: SessionRuntime): void {
    this.sendStored(
      client,
      this.runtimes.append(runtime, 'audio.ack', {
        audio_stream_id: runtime.audioStreamId,
        highest_audio_sequence_acked: runtime.highestAudioSequenceAcked,
      }),
    );
  }

  private eventAck(runtime: SessionRuntime, sequence: number): void {
    if (sequence < runtime.highestEventSequenceAcked || sequence >= runtime.nextServerSequence) {
      throw new RealtimeCodecError('INVALID_WS_MESSAGE');
    }
    runtime.highestEventSequenceAcked = sequence;
  }

  private onFailure(client: WebSocket, state: ConnectionState, error: unknown): void {
    if (error instanceof RealtimeCodecError) {
      this.fail(client, state, error.code, 4400);
      return;
    }
    if (error instanceof BackpressureError) {
      this.fail(client, state, 'BACKPRESSURE_LIMIT', 4429);
      return;
    }
    const code = httpErrorCode(error);
    if (code === 'INVALID_CSRF_TOKEN' || code === 'AUTH_REQUIRED')
      this.fail(client, state, code, 4401);
    else if (code === 'SESSION_NOT_STREAMABLE') this.fail(client, state, code, 4408);
    else if (code === 'FORBIDDEN' || code === 'NOT_FOUND')
      this.fail(client, state, 'FORBIDDEN', 4403);
    else this.fail(client, state, 'REALTIME_UNAVAILABLE', 4500);
  }

  private fail(
    client: WebSocket,
    state: ConnectionState,
    code: string,
    closeCode: number,
    resetRequired = false,
  ): void {
    if (client.readyState !== client.OPEN) return;
    if (state.runtime !== null) {
      this.sendStored(
        client,
        this.runtimes.append(state.runtime, 'error', {
          code,
          ...(resetRequired ? { reset_required: true } : {}),
        }),
      );
      this.runtimes.release(state.runtime, client);
    } else {
      const envelope: InterviewWsServerEnvelope<
        'error',
        { code: string; reset_required?: boolean }
      > = {
        event_id: randomUUID(),
        event_stream_id: randomUUID(),
        payload: {
          code,
          ...(resetRequired ? { reset_required: true } : {}),
        },
        schema_version: '1.1',
        server_sequence: 0,
        session_id: state.sessionId ?? NIL_UUID,
        timestamp: new Date().toISOString(),
        type: 'error',
      };
      this.sendStored(client, envelope);
    }
    state.acceptingMessages = false;
    state.closed = true;
    client.close(closeCode, code);
  }

  private sendStored(
    client: WebSocket,
    envelope: InterviewWsServerEnvelope<InterviewWsServerType, unknown>,
  ): void {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(envelope));
  }
}

class BackpressureError extends Error {}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function httpErrorCode(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  if (typeof response !== 'object' || !('code' in response)) return null;
  return String(response.code);
}
