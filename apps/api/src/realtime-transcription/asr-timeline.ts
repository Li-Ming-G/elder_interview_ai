import type { NormalizedAsrResult } from '../transcription/transcription.types.js';

export function mapAsrResultToSessionTimeline(
  result: NormalizedAsrResult,
  timelineOffsetMs: number,
): NormalizedAsrResult {
  if (timelineOffsetMs === 0) return result;
  return {
    ...result,
    endMs: result.endMs + timelineOffsetMs,
    startMs: result.startMs + timelineOffsetMs,
  };
}
