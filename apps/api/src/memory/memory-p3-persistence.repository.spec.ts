import { describe, expect, it } from 'vitest';

import { canonicalizeGraphRelation } from './memory-p3-persistence.repository.js';

describe('P3 persistence graph direction', () => {
  it('canonicalizes RELATED without storing a reverse duplicate', () => {
    expect(
      canonicalizeGraphRelation({
        projectId: '00000000-0000-4000-8000-000000000000',
        relationType: 'RELATED',
        sourceMemoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        targetMemoryId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toMatchObject({
      relationType: 'RELATED',
      sourceMemoryId: '11111111-1111-4111-8111-111111111111',
      targetMemoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
  });

  it('preserves direction for directed relations', () => {
    expect(
      canonicalizeGraphRelation({
        projectId: '00000000-0000-4000-8000-000000000000',
        relationType: 'CONTINUATION',
        sourceMemoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        targetMemoryId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toMatchObject({
      relationType: 'CONTINUATION',
      sourceMemoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      targetMemoryId: '11111111-1111-4111-8111-111111111111',
    });
  });
});
