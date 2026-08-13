export type AsrResultKind = 'final' | 'interim';
export type TranscriptSourceValue = 'backfill' | 'fixture' | 'realtime';
export type SpeakerRoleValue = 'elder' | 'interviewer' | 'unknown';

export interface NormalizedAsrResult {
  endMs: number;
  ingestKey: string;
  kind: AsrResultKind;
  providerPayload?: unknown;
  providerSegmentId?: string | null;
  sessionId: string;
  speakerStreamId?: string;
  source: TranscriptSourceValue;
  speakerProviderId?: string | null;
  startMs: number;
  text: string;
}

export interface TranscriptSegmentView {
  correctedAt: Date | null;
  correctedSpeakerRole: SpeakerRoleValue | null;
  correctedText: string | null;
  createdAt: Date;
  endMs: number;
  id: string;
  ingestKey: string;
  originalSpeakerRole: SpeakerRoleValue;
  originalRoleAuthority: 'unconfirmed' | 'user_confirmed';
  speakerRoleRevision: number;
  speakerStreamId: string;
  contentKind: 'conversation' | 'speaker_calibration';
  originalText: string;
  providerSegmentId: string | null;
  sessionId: string;
  source: TranscriptSourceValue;
  speakerProviderId: string | null;
  startMs: number;
}

export type TranscriptIngestionResult =
  | {
      contentKind: 'conversation' | 'speaker_calibration';
      kind: 'interim';
      persisted: false;
    }
  | { kind: 'final'; persisted: true; segment: TranscriptSegmentView };

export interface AppendSpeakerMappingInput {
  createdBy: string | null;
  role: SpeakerRoleValue;
  sessionId: string;
  speakerStreamId: string;
  source: 'batch_remap' | 'calibration' | 'manual' | 'provider';
  speakerProviderId: string;
}
