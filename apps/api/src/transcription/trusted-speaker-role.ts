import type { TranscriptSegmentResponse } from '@elder-interview/contracts';

import type { SpeakerRoleValue, TranscriptSegmentView } from './transcription.types.js';

export interface TrustedSpeakerRoleProjection {
  effectiveSpeakerRole: SpeakerRoleValue;
  trustedEffectiveSpeakerRole: SpeakerRoleValue;
}

export function projectTrustedSpeakerRole(
  segment: Pick<
    TranscriptSegmentView,
    'correctedSpeakerRole' | 'originalRoleAuthority' | 'originalSpeakerRole'
  >,
): TrustedSpeakerRoleProjection {
  const effectiveSpeakerRole = segment.correctedSpeakerRole ?? segment.originalSpeakerRole;
  return {
    effectiveSpeakerRole,
    trustedEffectiveSpeakerRole:
      segment.correctedSpeakerRole !== null || segment.originalRoleAuthority === 'user_confirmed'
        ? effectiveSpeakerRole
        : 'unknown',
  };
}

export function mapTranscriptResponse(segment: TranscriptSegmentView): TranscriptSegmentResponse {
  const projection = projectTrustedSpeakerRole(segment);
  return {
    content_kind: segment.contentKind,
    corrected_speaker_role: segment.correctedSpeakerRole,
    corrected_text: segment.correctedText,
    effective_speaker_role: projection.effectiveSpeakerRole,
    end_ms: segment.endMs,
    id: segment.id,
    original_speaker_role: segment.originalSpeakerRole,
    original_speaker_role_authority: segment.originalRoleAuthority,
    original_text: segment.originalText,
    speaker_provider_id: segment.speakerProviderId,
    speaker_role_revision: segment.speakerRoleRevision,
    speaker_stream_id: segment.speakerStreamId,
    start_ms: segment.startMs,
    trusted_effective_speaker_role: projection.trustedEffectiveSpeakerRole,
  };
}
