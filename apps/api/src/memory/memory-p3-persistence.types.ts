import type { MemoryP3GraphRelation } from './memory-p3-retrieval.types.js';

export interface MemoryP3EmbeddingInput {
  readonly projectId: string;
  readonly layerIdentityId: string;
  readonly layerRevisionId: string;
  readonly embeddingProfile: string;
  readonly embeddingVersion: string;
  readonly dimensions: number;
  readonly inputDigest: string;
  readonly vector: readonly number[];
}

export interface MemoryP3EmbeddingRecord extends MemoryP3EmbeddingInput {
  readonly id: string;
  readonly createdAt: Date;
}

export interface MemoryP3GraphRelationInput {
  readonly projectId: string;
  readonly sourceMemoryId: string;
  readonly targetMemoryId: string;
  readonly relationType: MemoryP3GraphRelation;
  readonly provenanceDigest?: string | null;
}

export interface MemoryP3GraphRelationRecord extends MemoryP3GraphRelationInput {
  readonly id: string;
  readonly sourceMemoryId: string;
  readonly targetMemoryId: string;
  readonly provenanceDigest: string | null;
  readonly createdAt: Date;
}

export interface MemoryP3GraphNeighbor {
  readonly relation: MemoryP3GraphRelationRecord;
  readonly neighborMemoryId: string;
}
