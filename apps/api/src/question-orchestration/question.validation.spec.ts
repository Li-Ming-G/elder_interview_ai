import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { validateHistoryQuery, validateManualNext, validateUuid } from './question.validation.js';

describe('question request validation', () => {
  it('accepts the canonical manual-next request', () => {
    expect(
      validateManualNext({
        expected_presentation_revision: 4,
        expected_snapshot_id: null,
        request_id: '11111111-1111-4111-8111-111111111111',
      }),
    ).toEqual({
      expectedPresentationRevision: 4,
      expectedSnapshotId: null,
      requestId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it.each([
    ['uuid', (): unknown => validateUuid('not-a-uuid')],
    ['revision', (): unknown => validateManualNext({ expected_presentation_revision: -1 })],
    ['history limit', (): unknown => validateHistoryQuery({ limit: 51 })],
    ['history token', (): unknown => validateHistoryQuery({ anchor: '' })],
  ])('fails closed for invalid %s input', (_label, run) => {
    expect(run).toThrow(BadRequestException);
  });
});
