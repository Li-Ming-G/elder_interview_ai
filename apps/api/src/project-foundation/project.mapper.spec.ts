import { describe, expect, it } from 'vitest';

import type { InterviewSession, SessionFinalization } from '../generated/prisma/client.js';
import {
  RECORDING_START_REMINDER_TEXT,
  RECORDING_START_REMINDER_VERSION,
} from '@elder-interview/contracts';

import { mapInterviewSessionSnapshot } from './project.mapper.js';

describe('mapInterviewSessionSnapshot recording reminder', () => {
  it.each(['created', 'device_check'] as const)(
    'projects the server-owned reminder for %s',
    (status) => {
      expect(
        mapInterviewSessionSnapshot(session(status), null, 0).recording_start_reminder,
      ).toEqual({
        action_label: '开始访谈',
        creates_consent_record: false,
        requires_explicit_action: true,
        text: RECORDING_START_REMINDER_TEXT,
        version: RECORDING_START_REMINDER_VERSION,
      });
    },
  );

  it('does not imply a pending acknowledgement after start', () => {
    expect(
      mapInterviewSessionSnapshot(session('recording'), null, 0).recording_start_reminder,
    ).toBeUndefined();
  });
});

describe('mapInterviewSessionSnapshot finalization bytes', () => {
  it('emits the exact safe complete AudioObject total as an explicit key', () => {
    const response = mapInterviewSessionSnapshot(
      session('completed'),
      finalization({ totalSizeBytes: 4_294_967_299n }),
      2,
    );

    expect(response.finalization).toHaveProperty('total_size_bytes', 4_294_967_299);
  });

  it.each([
    ['awaiting_upload', 'upload is not complete', 12n],
    ['complete', 'object is not complete', 12n],
    ['complete', 'manifest is missing', 12n],
    ['complete', 'total is missing', null],
    ['complete', 'total is unsafe', BigInt(Number.MAX_SAFE_INTEGER) + 1n],
  ] as const)('emits null for %s when %s', (audioStatus, reason, totalSizeBytes) => {
    const candidate = finalization({ totalSizeBytes });
    candidate.audioStatus = audioStatus;
    if (reason === 'object is not complete') candidate.audioObject.status = 'uploading';
    if (reason === 'manifest is missing') candidate.audioObject.manifestChecksum = null;

    const response = mapInterviewSessionSnapshot(session('processing'), candidate, 1);

    expect(response.finalization).toHaveProperty('total_size_bytes', null);
  });
});

function session(status: InterviewSession['status']): InterviewSession {
  return {
    captureFailureCode: null,
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    createdBy: 'actor',
    durationSeconds: 10,
    endedAt: new Date('2026-08-12T00:00:10.000Z'),
    id: '00000000-0000-4000-8000-000000000008',
    projectId: '00000000-0000-4000-8000-000000000009',
    sequenceNo: 1,
    startedAt: new Date('2026-08-12T00:00:00.000Z'),
    status,
    updatedAt: new Date('2026-08-12T00:00:10.000Z'),
  };
}

function finalization({
  totalSizeBytes,
}: {
  totalSizeBytes: bigint | null;
}): SessionFinalization & {
  audioObject: {
    manifestChecksum: string | null;
    status: string;
    totalSizeBytes: bigint | null;
  };
} {
  return {
    asrDrainCompletedAt: null,
    asrLastAudioSequenceAccepted: null,
    audioObject: {
      manifestChecksum: 'a'.repeat(64),
      status: 'complete',
      totalSizeBytes,
    },
    audioObjectId: '00000000-0000-4000-8000-000000000010',
    audioStatus: 'complete',
    captureEndedAt: new Date('2026-08-12T00:00:10.000Z'),
    commitmentsChecksum: 'b'.repeat(64),
    completedAt: new Date('2026-08-12T00:00:11.000Z'),
    createdAt: new Date('2026-08-12T00:00:10.000Z'),
    createdBy: 'actor',
    expectedChunkCount: 1,
    failureCode: null,
    id: '00000000-0000-4000-8000-000000000011',
    processingStartedAt: new Date('2026-08-12T00:00:10.500Z'),
    sessionId: '00000000-0000-4000-8000-000000000008',
    stopRequestId: '00000000-0000-4000-8000-000000000012',
    transcriptErrorCode: null,
    transcriptStatus: 'drained',
    updatedAt: new Date('2026-08-12T00:00:11.000Z'),
  };
}
