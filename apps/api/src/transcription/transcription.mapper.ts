import type { TranscriptSegment } from '../generated/prisma/client.js';
import type { TranscriptSegmentView } from './transcription.types.js';

export function mapTranscriptSegment(segment: TranscriptSegment): TranscriptSegmentView {
  return {
    correctedAt: segment.correctedAt,
    correctedSpeakerRole: segment.correctedSpeakerRole,
    correctedText: segment.correctedText,
    createdAt: segment.createdAt,
    endMs: segment.endMs,
    id: segment.id,
    ingestKey: segment.ingestKey,
    originalSpeakerRole: segment.originalSpeakerRole,
    originalRoleAuthority: segment.originalRoleAuthority,
    speakerRoleRevision: segment.speakerRoleRevision,
    speakerStreamId: segment.speakerStreamId,
    contentKind: segment.contentKind,
    originalText: segment.originalText,
    providerSegmentId: segment.providerSegmentId,
    sessionId: segment.sessionId,
    source: segment.source,
    speakerProviderId: segment.speakerProviderId,
    startMs: segment.startMs,
  };
}
