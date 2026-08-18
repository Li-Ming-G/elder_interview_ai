import { describe, expect, it } from 'vitest';

import {
  countUsefulCharacters,
  decideMemoryMaintainerTrigger,
} from './memory-maintainer.runtime.js';

describe('Memory Maintainer v1.2 trigger truth', () => {
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

  it('counts the selected batch cumulatively after NFKC and Unicode whitespace removal', () => {
    expect(countUsefulCharacters(['Ａ \n', '\u3000B', '😀'])).toBe(3);
    expect(countUsefulCharacters(['e\u0301', ' é '])).toBe(2);
  });

  it('counts Unicode code points rather than UTF-16 code units', () => {
    expect(countUsefulCharacters(['😀'])).toBe(1);
    expect(countUsefulCharacters(['👩‍💻'])).toBe(3);
  });
});
