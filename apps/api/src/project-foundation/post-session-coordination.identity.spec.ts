import { describe, expect, it } from 'vitest';

import {
  calibrationAttemptGateIdentity,
  calibrationUnavailableGateIdentity,
  openingRequestId,
  openingTriggerKey,
  postSessionLaneRequestId,
  postSessionLaneTriggerKey,
  postSessionTriggerIdentity,
  secondSessionOpeningIdentity,
  stableUuid,
} from './post-session-coordination.identity.js';

const BASIS_ID = '11111111-1111-4111-8111-111111111111';
const CONSUMER_ID = '22222222-2222-4222-8222-222222222222';

describe('DEV-008B2 stable coordination identities', () => {
  it('derives one durable root and two distinct bounded lane identities', () => {
    const root = postSessionTriggerIdentity(BASIS_ID, new Date('2026-08-14T08:00:00.000Z'));
    expect(root).toBe(
      'post-session-analysis-v1:11111111-1111-4111-8111-111111111111:2026-08-14T08:00:00.000Z',
    );
    expect(postSessionLaneTriggerKey(root, 'memory_extract')).not.toBe(
      postSessionLaneTriggerKey(root, 'actual_question_reconcile'),
    );
    expect(postSessionLaneRequestId(root, 'memory_extract')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(postSessionLaneTriggerKey(root, 'actual_question_reconcile').length).toBeLessThanOrEqual(
      160,
    );
  });

  it('binds basis analysis and calibration terminal into one exact opening identity', () => {
    const basis = postSessionTriggerIdentity(BASIS_ID, new Date('2026-08-14T08:00:00.000Z'));
    const gate = calibrationAttemptGateIdentity({
      attemptId: '33333333-3333-4333-8333-333333333333',
      speakerStreamId: '44444444-4444-4444-8444-444444444444',
      status: 'confirmed',
    });
    const identity = secondSessionOpeningIdentity({
      basisAnalysisTriggerIdentity: basis,
      calibrationGateIdentity: gate,
      consumerSessionId: CONSUMER_ID,
    });
    expect(openingRequestId(identity)).toBe(openingRequestId(identity));
    expect(openingTriggerKey(identity)).toBe(openingTriggerKey(identity));
    expect(openingTriggerKey(identity).length).toBeLessThanOrEqual(160);
    expect(openingRequestId(`${identity}:changed`)).not.toBe(openingRequestId(identity));
  });

  it('keeps no-attempt unavailable distinct from normal calibration and produces RFC UUIDs', () => {
    const unavailable = calibrationUnavailableGateIdentity('55555555-5555-4555-8555-555555555555');
    expect(unavailable).toContain('speaker-calibration-provider-unavailable-v1');
    expect(stableUuid(unavailable)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});
