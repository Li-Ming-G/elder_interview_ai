import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import {
  MEMORY_P3_GRAPH_RELATIONS,
  type MemoryP3GraphRelation,
} from './memory-p3-retrieval.types.js';
import {
  type MemoryP3EmbeddingInput,
  type MemoryP3EmbeddingRecord,
  type MemoryP3GraphNeighbor,
  type MemoryP3GraphRelationInput,
  type MemoryP3GraphRelationRecord,
} from './memory-p3-persistence.types.js';

interface RawEmbeddingRow {
  id: string;
  project_id: string;
  layer_identity_id: string;
  layer_revision_id: string;
  embedding_profile: string;
  embedding_version: string;
  dimensions: number;
  input_digest: string;
  vector: string;
  created_at: Date;
}

interface RawGraphRelationRow {
  id: string;
  project_id: string;
  source_memory_id: string;
  target_memory_id: string;
  relation_type: MemoryP3GraphRelation;
  provenance_digest: string | null;
  created_at: Date;
}

const GRAPH_RELATION_SET = new Set<MemoryP3GraphRelation>(MEMORY_P3_GRAPH_RELATIONS);

/**
 * P3 derived storage only. This repository does not read or write semantic
 * authority; it persists embeddings and identity-to-identity graph relations.
 */
@Injectable()
export class MemoryP3PersistenceRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async upsertEmbedding(input: MemoryP3EmbeddingInput): Promise<MemoryP3EmbeddingRecord> {
    assertEmbeddingInput(input);
    const vectorLiteral = `[${input.vector.join(',')}]`;
    const rows = await this.prisma.$queryRaw<RawEmbeddingRow[]>`
      INSERT INTO "memory_embedding"
        ("project_id", "layer_identity_id", "layer_revision_id", "embedding_profile",
         "embedding_version", "dimensions", "input_digest", "vector")
      VALUES
        (${input.projectId}::uuid, ${input.layerIdentityId}::uuid, ${input.layerRevisionId}::uuid,
         ${input.embeddingProfile}, ${input.embeddingVersion}, ${input.dimensions},
         ${input.inputDigest}, ${vectorLiteral}::vector)
      ON CONFLICT
        ("project_id", "layer_identity_id", "layer_revision_id", "embedding_profile", "embedding_version")
      DO UPDATE SET
        "dimensions" = EXCLUDED."dimensions",
        "input_digest" = EXCLUDED."input_digest",
        "vector" = EXCLUDED."vector"
      RETURNING "id", "project_id", "layer_identity_id", "layer_revision_id",
        "embedding_profile", "embedding_version", "dimensions", "input_digest", "vector", "created_at"
    `;
    const row = rows[0];
    if (row === undefined) throw new Error('memory embedding upsert returned no row');
    return mapEmbedding(row);
  }

  public async listEmbeddings(projectId: string): Promise<readonly MemoryP3EmbeddingRecord[]> {
    const rows = await this.prisma.$queryRaw<RawEmbeddingRow[]>`
      SELECT "id", "project_id", "layer_identity_id", "layer_revision_id",
        "embedding_profile", "embedding_version", "dimensions", "input_digest", "vector", "created_at"
      FROM "memory_embedding"
      WHERE "project_id" = ${projectId}::uuid
      ORDER BY "layer_identity_id", "layer_revision_id", "embedding_profile", "embedding_version", "id"
    `;
    return rows.map(mapEmbedding);
  }

  public async createGraphRelation(
    input: MemoryP3GraphRelationInput,
  ): Promise<MemoryP3GraphRelationRecord> {
    assertGraphRelationInput(input);
    const rows = await this.prisma.$queryRaw<RawGraphRelationRow[]>`
      INSERT INTO "memory_graph_relation"
        ("project_id", "source_memory_id", "target_memory_id", "relation_type", "provenance_digest")
      VALUES
        (${input.projectId}::uuid, ${input.sourceMemoryId}::uuid,
         ${input.targetMemoryId}::uuid, ${input.relationType}, ${input.provenanceDigest ?? null})
      ON CONFLICT
        ("project_id", "source_memory_id", "target_memory_id", "relation_type")
      DO NOTHING
      RETURNING "id", "project_id", "source_memory_id", "target_memory_id", "relation_type",
        "provenance_digest", "created_at"
    `;
    if (rows[0] !== undefined) return mapGraphRelation(rows[0]);

    const existing = await this.prisma.$queryRaw<RawGraphRelationRow[]>`
      SELECT "id", "project_id", "source_memory_id", "target_memory_id", "relation_type",
        "provenance_digest", "created_at"
      FROM "memory_graph_relation"
      WHERE "project_id" = ${input.projectId}::uuid
        AND "source_memory_id" = ${input.sourceMemoryId}::uuid
        AND "target_memory_id" = ${input.targetMemoryId}::uuid
        AND "relation_type" = ${input.relationType}
    `;
    const row = existing[0];
    if (row === undefined) throw new Error('memory graph relation replay returned no row');
    return mapGraphRelation(row);
  }

  /** Directed relations are followed from source; RELATED is followed both ways. */
  public async listGraphNeighbors(
    projectId: string,
    memoryId: string,
    limit?: number,
  ): Promise<readonly MemoryP3GraphNeighbor[]> {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
      throw new Error('graph limit must be a non-negative safe integer');
    const rows =
      limit === undefined
        ? await this.prisma.$queryRaw<RawGraphRelationRow[]>`
            SELECT "id", "project_id", "source_memory_id", "target_memory_id", "relation_type",
              "provenance_digest", "created_at"
            FROM "memory_graph_relation"
            WHERE "project_id" = ${projectId}::uuid
              AND (
                "source_memory_id" = ${memoryId}::uuid
                OR ("relation_type" = 'RELATED' AND "target_memory_id" = ${memoryId}::uuid)
              )
            ORDER BY "relation_type", "source_memory_id", "target_memory_id", "id"
          `
        : await this.prisma.$queryRaw<RawGraphRelationRow[]>`
            SELECT "id", "project_id", "source_memory_id", "target_memory_id", "relation_type",
              "provenance_digest", "created_at"
            FROM "memory_graph_relation"
            WHERE "project_id" = ${projectId}::uuid
              AND (
                "source_memory_id" = ${memoryId}::uuid
                OR ("relation_type" = 'RELATED' AND "target_memory_id" = ${memoryId}::uuid)
              )
            ORDER BY "relation_type", "source_memory_id", "target_memory_id", "id"
            LIMIT ${limit}
          `;
    return rows.map((row) => ({
      neighborMemoryId:
        row.source_memory_id === memoryId ? row.target_memory_id : row.source_memory_id,
      relation: mapGraphRelation(row),
    }));
  }
}

function assertEmbeddingInput(input: MemoryP3EmbeddingInput): void {
  if (!Number.isSafeInteger(input.dimensions) || input.dimensions < 1)
    throw new Error('embedding dimensions must be a positive safe integer');
  if (input.vector.length !== input.dimensions)
    throw new Error('embedding vector length must equal dimensions');
  if (input.vector.some((value) => !Number.isFinite(value)))
    throw new Error('embedding vector values must be finite');
  if (!/^[0-9a-f]{64}$/.test(input.inputDigest))
    throw new Error('embedding input digest must be a lowercase sha256 digest');
  if (input.embeddingProfile.trim().length === 0 || input.embeddingProfile.length > 120)
    throw new Error('embedding profile is invalid');
  if (input.embeddingVersion.trim().length === 0 || input.embeddingVersion.length > 120)
    throw new Error('embedding version is invalid');
}

function assertGraphRelationInput(input: MemoryP3GraphRelationInput): void {
  if (!GRAPH_RELATION_SET.has(input.relationType)) throw new Error('graph relation is invalid');
  if (input.sourceMemoryId === input.targetMemoryId)
    throw new Error('graph relation cannot self-link');
  if (input.provenanceDigest !== undefined && input.provenanceDigest !== null)
    if (!/^[0-9a-f]{64}$/.test(input.provenanceDigest))
      throw new Error('graph provenance digest must be a lowercase sha256 digest');
}

function mapEmbedding(row: RawEmbeddingRow): MemoryP3EmbeddingRecord {
  return {
    createdAt: row.created_at,
    dimensions: row.dimensions,
    embeddingProfile: row.embedding_profile,
    embeddingVersion: row.embedding_version,
    id: row.id,
    inputDigest: row.input_digest,
    layerIdentityId: row.layer_identity_id,
    layerRevisionId: row.layer_revision_id,
    projectId: row.project_id,
    vector: parseVector(row.vector),
  };
}

function mapGraphRelation(row: RawGraphRelationRow): MemoryP3GraphRelationRecord {
  return {
    createdAt: row.created_at,
    id: row.id,
    projectId: row.project_id,
    provenanceDigest: row.provenance_digest,
    relationType: row.relation_type,
    sourceMemoryId: row.source_memory_id,
    targetMemoryId: row.target_memory_id,
  };
}

function parseVector(value: string): readonly number[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) throw new Error('invalid vector value');
  return trimmed
    .slice(1, -1)
    .split(',')
    .filter((item) => item.length > 0)
    .map((item) => Number(item));
}
