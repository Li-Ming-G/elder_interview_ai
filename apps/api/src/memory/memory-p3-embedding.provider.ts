import { Injectable } from '@nestjs/common';

import { sha256 } from '../ai-runtime/ai-provenance.js';
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
} from './memory-p3-retrieval.types.js';

export const MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID = 'deterministic-fake' as const;
export const MEMORY_P3_FAKE_EMBEDDING_MODEL_ID = 'deterministic-fake-v1' as const;
export const MEMORY_P3_FAKE_EMBEDDING_DIMENSIONS = 16 as const;

/** Synthetic-only provider for tests and local indexing fixtures. */
@Injectable()
export class DeterministicFakeEmbeddingProvider implements EmbeddingProvider {
  public readonly modelId = MEMORY_P3_FAKE_EMBEDDING_MODEL_ID;
  public readonly providerId = MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID;

  public constructor(private readonly dimensions: number = MEMORY_P3_FAKE_EMBEDDING_DIMENSIONS) {
    if (!Number.isSafeInteger(dimensions) || dimensions < 1)
      throw new Error('fake embedding dimensions must be a positive safe integer');
  }

  public embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const vector = Array.from({ length: this.dimensions }, (_, index) => {
      const digest = sha256(`memory-p3-fake-embedding-v1:${String(index)}:${request.input}`);
      const integer = Number.parseInt(digest.slice(0, 8), 16);
      return integer / 0xffffffff;
    });
    return Promise.resolve({
      dimensions: this.dimensions,
      modelId: this.modelId,
      providerId: this.providerId,
      vector,
    });
  }
}
