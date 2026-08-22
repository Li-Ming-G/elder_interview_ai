import { Injectable } from '@nestjs/common';

import type { EmbeddingProvider } from './memory-p3-retrieval.types.js';
import { MemoryP3PersistenceRepository } from './memory-p3-persistence.repository.js';
import type {
  MemoryP3EmbeddingInput,
  MemoryP3EmbeddingRecord,
} from './memory-p3-persistence.types.js';
import { type MemoryP3Source, type MemoryP3SourceReaderPort } from './memory-p3-source.reader.js';

export interface MemoryP3IndexRequest {
  readonly projectId: string;
  readonly embeddingProfile: string;
  readonly embeddingVersion: string;
}

export interface MemoryP3IndexResult {
  readonly projectId: string;
  readonly indexed: readonly MemoryP3EmbeddingRecord[];
  readonly skippedStale: number;
}

/** Indexes P2 semantic sources into P3 derived embedding storage only. */
@Injectable()
export class MemoryP3IndexService {
  public constructor(
    private readonly sourceReader: MemoryP3SourceReaderPort,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly persistence: MemoryP3PersistenceRepository,
  ) {}

  public async index(request: MemoryP3IndexRequest): Promise<MemoryP3IndexResult> {
    assertIndexRequest(request);
    const sources = await this.sourceReader.read(request.projectId);
    const indexed: MemoryP3EmbeddingRecord[] = [];
    let skippedStale = 0;
    for (const source of sources) {
      const embedding = await this.embeddingProvider.embed({ input: source.safeContent });
      assertEmbeddingResult(embedding, request);
      const current = await this.sourceReader.readCurrentLayer(source.layerIdentityId);
      if (current === null || !sameCurrentContent(current, source)) {
        skippedStale += 1;
        continue;
      }
      const input: MemoryP3EmbeddingInput = {
        dimensions: embedding.dimensions,
        embeddingProfile: request.embeddingProfile,
        embeddingVersion: request.embeddingVersion,
        inputDigest: source.contentDigest,
        layerIdentityId: source.layerIdentityId,
        layerRevisionId: source.layerRevisionId,
        projectId: source.projectId,
        vector: embedding.vector,
      };
      const record = await this.persistence.upsertEmbedding(input);
      assertPersistedEmbedding(record, input);
      indexed.push(record);
    }
    return { indexed, projectId: request.projectId, skippedStale };
  }
}

function assertIndexRequest(request: MemoryP3IndexRequest): void {
  if (request.projectId.trim().length === 0) throw new Error('project id is required');
  if (request.embeddingProfile.trim().length === 0)
    throw new Error('embedding profile is required');
  if (request.embeddingVersion.trim().length === 0)
    throw new Error('embedding version is required');
}

function assertEmbeddingResult(
  result: Awaited<ReturnType<EmbeddingProvider['embed']>>,
  request: MemoryP3IndexRequest,
): void {
  if (!Number.isSafeInteger(result.dimensions) || result.dimensions < 1)
    throw new Error('embedding dimensions must be a positive safe integer');
  if (result.vector.length !== result.dimensions)
    throw new Error('embedding vector length must equal dimensions');
  if (result.vector.some((value) => !Number.isFinite(value)))
    throw new Error('embedding vector values must be finite');
  if (result.providerId.trim().length === 0) throw new Error('embedding provider id is required');
  if (result.modelId === undefined || result.modelId.trim().length === 0)
    throw new Error('embedding model id is required');
  if (result.providerId !== request.embeddingProfile)
    throw new Error('embedding provider id does not match profile');
  if (result.modelId !== request.embeddingVersion)
    throw new Error('embedding model id does not match version');
}

function sameCurrentContent(left: MemoryP3Source, right: MemoryP3Source): boolean {
  return (
    left.projectId === right.projectId &&
    left.layerIdentityId === right.layerIdentityId &&
    left.layerRevisionId === right.layerRevisionId &&
    left.contentDigest === right.contentDigest
  );
}

function assertPersistedEmbedding(
  record: MemoryP3EmbeddingRecord,
  input: MemoryP3EmbeddingInput,
): void {
  if (
    record.projectId !== input.projectId ||
    record.layerIdentityId !== input.layerIdentityId ||
    record.layerRevisionId !== input.layerRevisionId ||
    record.embeddingProfile !== input.embeddingProfile ||
    record.embeddingVersion !== input.embeddingVersion ||
    record.dimensions !== input.dimensions ||
    record.inputDigest !== input.inputDigest ||
    record.vector.length !== input.vector.length ||
    record.vector.some((value, index) => value !== input.vector[index])
  )
    throw new Error('persisted embedding does not match its source metadata');
}
