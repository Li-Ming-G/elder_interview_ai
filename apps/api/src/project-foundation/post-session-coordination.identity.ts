import { createHash } from 'node:crypto';

export type PostSessionLane = 'memory_extract' | 'actual_question_reconcile';

export const CALIBRATION_PROVIDER_UNAVAILABLE_POLICY_REVISION =
  'speaker-calibration-provider-unavailable-v1';

export function postSessionTriggerIdentity(sessionId: string, completedAt: Date): string {
  return `post-session-analysis-v1:${sessionId}:${completedAt.toISOString()}`;
}

export function postSessionLaneTriggerKey(root: string, lane: PostSessionLane): string {
  return `post-lane-v1:${sha256(`${root}:${lane}:attempt:1`)}`;
}

export function postSessionLaneRequestId(root: string, lane: PostSessionLane): string {
  return stableUuid(`${root}:${lane}:attempt:1`);
}

export function calibrationAttemptGateIdentity(input: {
  attemptId: string;
  speakerStreamId: string;
  status: 'confirmed' | 'failed' | 'skipped';
}): string {
  return `speaker-calibration-v1:${input.speakerStreamId}:${input.attemptId}:${input.status}`;
}

export function calibrationUnavailableGateIdentity(captureGenerationId: string): string {
  return `speaker-calibration-unavailable-v1:${captureGenerationId}:${CALIBRATION_PROVIDER_UNAVAILABLE_POLICY_REVISION}`;
}

export function secondSessionOpeningIdentity(input: {
  basisAnalysisTriggerIdentity: string;
  calibrationGateIdentity: string;
  consumerSessionId: string;
}): string {
  return `second-session-opening-v1:${input.consumerSessionId}:${input.basisAnalysisTriggerIdentity}:${input.calibrationGateIdentity}`;
}

export function openingTriggerKey(identity: string): string {
  return `opening-v1:${sha256(identity)}`;
}

export function openingRequestId(identity: string): string {
  return stableUuid(identity);
}

export function openingContextTriggerKey(identity: string): string {
  return `opening-context-v1:${sha256(identity)}`;
}

export function openingContextRequestId(identity: string): string {
  return stableUuid(`${identity}:context-snapshot`);
}

export function stableUuid(value: string): string {
  const chars = sha256(value).slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = ['8', '9', 'a', 'b'][Number.parseInt(chars[16] ?? '0', 16) % 4] ?? '8';
  return `${chars.slice(0, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}-${chars.slice(16, 20).join('')}-${chars.slice(20).join('')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
