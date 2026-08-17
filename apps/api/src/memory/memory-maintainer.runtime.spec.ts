import { describe, expect, it } from 'vitest';

import { decideMemoryMaintainerTrigger } from './memory-maintainer.runtime.js';

describe('Memory Maintainer v1.1 trigger truth', () => {
  for (const [batchReached, timeReached, minimumUseful, expected] of [
    [false, false, false, null],
    [false, false, true, null],
    [true, false, false, null],
    [false, true, false, null],
    [true, true, false, null],
    [true, false, true, 'batch_threshold'],
    [false, true, true, 'time_threshold'],
    [true, true, true, 'batch_threshold'],
  ] as const) {
    it(`${String(batchReached)}/${String(timeReached)}/${String(minimumUseful)} -> ${String(expected)}`, () => {
      expect(
        decideMemoryMaintainerTrigger({
          batchReached,
          finalFlush: false,
          minimumUseful,
          timeReached,
        }),
      ).toBe(expected);
    });
  }

  it('final flush uses the same minimum-useful gate', () => {
    expect(
      decideMemoryMaintainerTrigger({
        batchReached: false,
        finalFlush: true,
        minimumUseful: false,
        timeReached: false,
      }),
    ).toBeNull();
    expect(
      decideMemoryMaintainerTrigger({
        batchReached: false,
        finalFlush: true,
        minimumUseful: true,
        timeReached: false,
      }),
    ).toBe('session_final_flush');
  });
});
