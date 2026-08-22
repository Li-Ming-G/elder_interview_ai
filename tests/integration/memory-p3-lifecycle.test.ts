import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestPrismaClient } from '../../apps/api/test-support/prisma-client.js';
import type { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { MemoryP3PersistenceRepository } from '../../apps/api/src/memory/memory-p3-persistence.repository.js';
import { MemoryP3IndexService } from '../../apps/api/src/memory/memory-p3-index.service.js';
import { MemoryP3RetrievalService } from '../../apps/api/src/memory/memory-p3-retrieval.service.js';
import type {
  EmbeddingProvider,
  MemoryP3RetrievalRequest,
} from '../../apps/api/src/memory/memory-p3-retrieval.types.js';
import type {
  MemoryP3Source,
  MemoryP3SourceReaderPort,
} from '../../apps/api/src/memory/memory-p3-source.reader.js';

const requireFromApi = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../../apps/api/package.json'),
);
const { Client } = requireFromApi('pg') as {
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ rows: T[] }>;
  };
};

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ids = {
  currentMid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  crossSessionLong: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  graphOnlyLong: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  otherSessionMid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  currentMidRevision: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  crossSessionLongRevision: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  graphOnlyLongRevision: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  otherSessionMidRevision: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
};

describe('T9-T10 / P3R-05 synthetic PostgreSQL lifecycle', () => {
  let client!: InstanceType<typeof Client>;
  let prisma!: ReturnType<typeof createTestPrismaClient>;
  let repository!: MemoryP3PersistenceRepository;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    prisma = createTestPrismaClient(databaseUrl);
    repository = new MemoryP3PersistenceRepository(prisma as unknown as PrismaService);

    await client.query('SET session_replication_role = replica');
    await client.query('DELETE FROM "memory_embedding" WHERE "project_id" = $1', [projectId]);
    await client.query('DELETE FROM "memory_graph_relation" WHERE "project_id" = $1', [projectId]);
    for (const [identityId, revisionId, sessionId] of [
      [ids.currentMid, ids.currentMidRevision, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'],
      [ids.crossSessionLong, ids.crossSessionLongRevision, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'],
      [ids.graphOnlyLong, ids.graphOnlyLongRevision, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'],
      [ids.otherSessionMid, ids.otherSessionMidRevision, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'],
    ] as const) {
      await client.query(
        `INSERT INTO "memory_layer_identity"
          ("id", "project_id", "origin_session_id", "origin_thread_id",
           "origin_resolution_authority_id", "identity_key_digest")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("id") DO NOTHING`,
        [
          identityId,
          projectId,
          sessionId,
          'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
          identityId,
          identityId.replaceAll('-', '').padEnd(64, '0'),
        ],
      );
      await client.query(
        `INSERT INTO "memory_layer_revision"
          ("id", "identity_id", "layer", "revision_no", "lifecycle_status", "project_id",
           "source_session_id", "source_checkpoint_id", "source_job_id", "resolution_row_id",
           "resolution_authority_id", "resolution_revision", "semantic_status", "expected_member_count",
           "member_manifest_hash", "manifest_algorithm_version")
         VALUES ($1, $2, $3, 1, 'current', $4, $5, $6, $7, $8, $9, 1, 'current', 0, $10, 'p3-test')
         ON CONFLICT ("id") DO NOTHING`,
        [
          revisionId,
          identityId,
          identityId === ids.currentMid || identityId === ids.otherSessionMid ? 'mid' : 'long',
          projectId,
          sessionId,
          identityId,
          identityId,
          identityId,
          identityId,
          'e'.repeat(64),
        ],
      );
    }
    await client.query('SET session_replication_role = origin');
  });

  afterAll(async () => {
    // beforeAll may fail before a client is assigned when PostgreSQL is unavailable.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (client !== undefined) {
      await client.query('SET session_replication_role = replica');
      await client.query('DELETE FROM "memory_graph_relation" WHERE "project_id" = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM "memory_embedding" WHERE "project_id" = $1', [projectId]);
      await client.query('DELETE FROM "memory_layer_revision" WHERE "project_id" = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM "memory_layer_identity" WHERE "project_id" = $1', [
        projectId,
      ]);
      await client.query('SET session_replication_role = origin');
      await client.end();
      await prisma.$disconnect();
    }
  });

  it('syncs pgvector rows, replays idempotently, recalls Mid/Long, and unions graph sources', async () => {
    const sources = [
      source(
        ids.currentMid,
        ids.currentMidRevision,
        'mid',
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        'current semantic mid',
      ),
      source(
        ids.crossSessionLong,
        ids.crossSessionLongRevision,
        'long',
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
        'cross session semantic long',
      ),
      source(
        ids.graphOnlyLong,
        ids.graphOnlyLongRevision,
        'long',
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
        'graph neighbor semantic long',
      ),
    ];
    const reader = readerFor(sources);
    const provider = fixedProvider();
    const index = new MemoryP3IndexService(reader, provider, repository);
    const indexRequest = {
      projectId,
      embeddingProfile: 'synthetic-provider',
      embeddingVersion: 'synthetic-v1',
    };

    const first = await index.index(indexRequest);
    const replay = await index.index(indexRequest);
    expect(first.indexed).toHaveLength(3);
    expect(replay.indexed.map((row) => row.id)).toEqual(first.indexed.map((row) => row.id));
    expect(await repository.listEmbeddings(projectId)).toHaveLength(3);
    await client.query('DELETE FROM "memory_embedding" WHERE "layer_identity_id" = $1', [
      ids.graphOnlyLong,
    ]);

    await repository.createGraphRelation({
      projectId,
      sourceMemoryId: ids.currentMid,
      targetMemoryId: ids.crossSessionLong,
      relationType: 'RELATED',
    });
    await repository.createGraphRelation({
      projectId,
      sourceMemoryId: ids.currentMid,
      targetMemoryId: ids.graphOnlyLong,
      relationType: 'CONTINUATION',
    });
    const service = new MemoryP3RetrievalService(reader, provider, repository);
    const result = await service.retrieve(request());

    expect(result.candidates.map((candidate) => candidate.memoryId)).toEqual([
      ids.currentMid,
      ids.crossSessionLong,
      ids.graphOnlyLong,
    ]);
    expect(result.candidates[0]?.retrievalSources).toEqual(['embedding', 'graph']);
    expect(result.candidates[1]?.retrievalSources).toEqual(['embedding', 'graph']);
    expect(result.candidates[2]?.retrievalSources).toEqual(['graph']);
    expect(result.candidates.every((candidate) => !candidate.memoryId.includes('working'))).toBe(
      true,
    );
    expect(
      result.candidates.every((candidate) => !candidate.safeContent.includes('transcript')),
    ).toBe(true);
  });

  it('returns empty when no readable semantic row meets the threshold', async () => {
    const unreadableSource = source(
      ids.otherSessionMid,
      ids.otherSessionMidRevision,
      'mid',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
      'unreadable superseded expired hidden stale transcript',
    );
    const result = await new MemoryP3RetrievalService(
      readerFor([unreadableSource]),
      fixedProvider([0, 1]),
      repository,
    ).retrieve({
      ...request(),
      configuration: { ...request().configuration, embeddingThreshold: 0.99 },
    });
    expect(result.candidates).toEqual([]);
  });
});

function fixedProvider(vector: readonly number[] = [1, 0]): EmbeddingProvider {
  return {
    providerId: 'synthetic-provider',
    embed: () =>
      Promise.resolve({
        dimensions: vector.length,
        modelId: 'synthetic-v1',
        providerId: 'synthetic-provider',
        vector,
      }),
  };
}

function readerFor(sources: readonly MemoryP3Source[]): MemoryP3SourceReaderPort {
  return {
    read: () => Promise.resolve(sources),
    readCurrentLayer: (id) =>
      Promise.resolve(sources.find((source) => source.layerIdentityId === id) ?? null),
  };
}

function source(
  id: string,
  revisionId: string,
  sourceLevel: 'mid' | 'long',
  sessionId: string,
  safeContent: string,
): MemoryP3Source {
  return {
    projectId,
    layerIdentityId: id,
    layerRevisionId: revisionId,
    revisionNo: 1,
    sourceLevel,
    resolutionAuthorityId: id,
    originSessionId: sessionId,
    originThreadId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    semanticKind: 'fact',
    semanticStatus: 'current',
    safeContent,
    contentDigest: id.replaceAll('-', '').padEnd(64, '0'),
  };
}

function request(): MemoryP3RetrievalRequest {
  return {
    contractVersion: 'memory-p3-retrieval-v1',
    projectId,
    currentSessionId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    activeThreadId: null,
    activeThreadRevision: null,
    currentWorkingSignals: [
      {
        signalId: 'working-only',
        workingMemoryId: 'working-only',
        threadId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        revision: 1,
        semanticKind: 'fact',
        semanticStatus: 'current',
        queryText: 'working query',
      },
    ],
    recentEligibleTranscriptSignals: [],
    queryVector: undefined,
    configuration: { embeddingThreshold: 0.5, candidateLimit: 8, graphDepth: 2, graphLimit: 8 },
  };
}
