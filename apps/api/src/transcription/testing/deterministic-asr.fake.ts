import type { NormalizedAsrResult } from '../transcription.types.js';

/** Test/local-only deterministic source. It is never registered by TranscriptionModule. */
export class DeterministicAsrFake {
  private index = 0;

  public constructor(
    private readonly results: readonly NormalizedAsrResult[],
    private readonly failAtIndex: number | null = null,
  ) {}

  public next(): Promise<NormalizedAsrResult | null> {
    if (this.failAtIndex === this.index) {
      return Promise.reject(new Error('TEST_ONLY_ASR_FAILURE'));
    }
    const result = this.results[this.index];
    if (result === undefined) return Promise.resolve(null);
    this.index += 1;
    return Promise.resolve(structuredClone(result));
  }
}
