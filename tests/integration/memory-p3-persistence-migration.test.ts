import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const requireFromApi = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../../apps/api/package.json'),
);
const { Client } = requireFromApi('pg') as {
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    // Mirrors pg.Client.query; the generic is intentionally selected at each call site.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ rows: T[] }>;
  };
};

describe('T9-T10 / P3R-02 retrieval substrate migration', () => {
  let client!: InstanceType<typeof Client>;
  const ids = {
    authority: randomUUID(),
    secondAuthority: randomUUID(),
    project: randomUUID(),
    session: randomUUID(),
    thread: randomUUID(),
    user: randomUUID(),
    firstIdentity: randomUUID(),
    secondIdentity: randomUUID(),
  };

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(
      `INSERT INTO "user" ("id", "email", "display_name", "password_hash", "role", "updated_at")
       VALUES ($1, $2, 'P3 fictional fixture', 'test-only', 'interviewer', now())`,
      [ids.user, `p3-${ids.user}@example.test`],
    );
    await client.query(
      `INSERT INTO "elder_project" ("id", "display_name", "created_by", "updated_at")
       VALUES ($1, 'P3 fictional project', $2, now())`,
      [ids.project, ids.user],
    );
    await client.query(
      `INSERT INTO "interview_session" ("id", "project_id", "sequence_no", "created_by", "updated_at")
       VALUES ($1, $2, 1, $3, now())`,
      [ids.session, ids.project, ids.user],
    );
    await client.query(
      `INSERT INTO "memory_thread" ("id", "project_id", "origin_session_id")
       VALUES ($1, $2, $3)`,
      [ids.thread, ids.project, ids.session],
    );
    await client.query(
      `INSERT INTO "memory_resolution_authority"
         ("authority_id", "project_id", "semantic_kind", "canonical_key", "origin_session_id", "origin_thread_id")
       VALUES ($1, $2, 'fact', 'p3.fixture', $3, $4)`,
      [ids.authority, ids.project, ids.session, ids.thread],
    );
    await client.query(
      `INSERT INTO "memory_resolution_authority"
         ("authority_id", "project_id", "semantic_kind", "canonical_key", "origin_session_id", "origin_thread_id")
       VALUES ($1, $2, 'fact', 'p3.fixture.second', $3, $4)`,
      [ids.secondAuthority, ids.project, ids.session, ids.thread],
    );
    for (const [identityId, authorityId, digest] of [
      [ids.firstIdentity, ids.authority, 'a'.repeat(64)],
      [ids.secondIdentity, ids.secondAuthority, 'b'.repeat(64)],
    ] as const)
      await client.query(
        `INSERT INTO "memory_layer_identity"
           ("id", "project_id", "origin_session_id", "origin_thread_id",
            "origin_resolution_authority_id", "identity_key_digest")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [identityId, ids.project, ids.session, ids.thread, authorityId, digest],
      );
  });

  afterAll(async () => {
    // beforeAll may fail before a client is assigned when PostgreSQL is unavailable.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (client !== undefined) {
      await client.query('SET session_replication_role = replica');
      await client.query('DELETE FROM "memory_graph_relation" WHERE "project_id" = $1', [
        ids.project,
      ]);
      await client.query('DELETE FROM "memory_layer_identity" WHERE "id" = ANY($1::uuid[])', [
        [ids.firstIdentity, ids.secondIdentity],
      ]);
      await client.query('DELETE FROM "memory_resolution_authority" WHERE "authority_id" = $1', [
        ids.authority,
      ]);
      await client.query('DELETE FROM "memory_resolution_authority" WHERE "authority_id" = $1', [
        ids.secondAuthority,
      ]);
      await client.query('DELETE FROM "memory_thread" WHERE "id" = $1', [ids.thread]);
      await client.query('DELETE FROM "interview_session" WHERE "id" = $1', [ids.session]);
      await client.query('DELETE FROM "elder_project" WHERE "id" = $1', [ids.project]);
      await client.query('DELETE FROM "user" WHERE "id" = $1', [ids.user]);
      await client.query('SET session_replication_role = origin');
      await client.end();
    }
  });

  it('installs pgvector without freezing a provider-specific dimension', async () => {
    const extension = await client.query<{ extname: string }>(
      `SELECT "extname" FROM "pg_extension" WHERE "extname" = 'vector'`,
    );
    expect(extension.rows).toEqual([{ extname: 'vector' }]);
    const vectorColumn = await client.query<{ data_type: string; typmod: number }>(
      `SELECT format_type(a."atttypid", a."atttypmod") AS data_type,
              a."atttypmod" AS typmod
         FROM "pg_attribute" a
         JOIN "pg_class" c ON c."oid" = a."attrelid"
        WHERE c."relname" = 'memory_embedding' AND a."attname" = 'vector'`,
    );
    expect(vectorColumn.rows).toEqual([{ data_type: 'vector', typmod: -1 }]);
  });

  it('enforces graph scope, relation set, direction and RELATED traversal shape', async () => {
    const sourceMemoryId =
      ids.firstIdentity < ids.secondIdentity ? ids.firstIdentity : ids.secondIdentity;
    const targetMemoryId =
      ids.firstIdentity < ids.secondIdentity ? ids.secondIdentity : ids.firstIdentity;
    await client.query(
      `INSERT INTO "memory_graph_relation"
         ("project_id", "source_memory_id", "target_memory_id", "relation_type")
       VALUES ($1, $2, $3, 'RELATED')`,
      [ids.project, sourceMemoryId, targetMemoryId],
    );
    const related = await client.query<{ source_memory_id: string; target_memory_id: string }>(
      `SELECT "source_memory_id"::text, "target_memory_id"::text
         FROM "memory_graph_relation"
        WHERE "project_id" = $1`,
      [ids.project],
    );
    expect(related.rows).toEqual([
      { source_memory_id: sourceMemoryId, target_memory_id: targetMemoryId },
    ]);

    await expect(
      client.query(
        `INSERT INTO "memory_graph_relation"
           ("project_id", "source_memory_id", "target_memory_id", "relation_type")
         VALUES ($1, $2, $2, 'BRANCH')`,
        [ids.project, ids.firstIdentity],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query(
        `INSERT INTO "memory_graph_relation"
           ("project_id", "source_memory_id", "target_memory_id", "relation_type")
         VALUES ($1, $2, $3, 'CHILD')`,
        [ids.project, ids.firstIdentity, ids.secondIdentity],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query(
        `INSERT INTO "memory_graph_relation"
           ("project_id", "source_memory_id", "target_memory_id", "relation_type")
         VALUES ($1, $2, $3, 'RELATED')`,
        [ids.project, targetMemoryId, sourceMemoryId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('uses cascading derived-row cleanup and same-project composite references', async () => {
    const source = await client.query<{ source_memory_id: string }>(
      `SELECT "source_memory_id"::text
         FROM "memory_graph_relation"
        WHERE "project_id" = $1`,
      [ids.project],
    );
    expect(source.rows).toHaveLength(1);
    const foreignKeys = await client.query<{ name: string; delete_type: string }>(
      `SELECT c."conname" AS name, c."confdeltype" AS delete_type
         FROM "pg_constraint" c
        WHERE c."conname" IN ('memory_embedding_identity_fk', 'memory_embedding_revision_fk',
                               'memory_graph_relation_source_fk', 'memory_graph_relation_target_fk')
        ORDER BY c."conname"`,
    );
    expect(foreignKeys.rows).toEqual([
      { name: 'memory_embedding_identity_fk', delete_type: 'c' },
      { name: 'memory_embedding_revision_fk', delete_type: 'c' },
      { name: 'memory_graph_relation_source_fk', delete_type: 'c' },
      { name: 'memory_graph_relation_target_fk', delete_type: 'c' },
    ]);
    const retentionForeignKeys = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM "pg_constraint" c
         JOIN "pg_class" parent ON parent."oid" = c."confrelid"
        WHERE c."conrelid" IN ('memory_embedding'::regclass, 'memory_graph_relation'::regclass)
          AND parent."relname" IN ('memory_retention_root', 'ai_job')`,
    );
    expect(retentionForeignKeys.rows[0]?.count).toBe('0');
    await client.query('DELETE FROM "memory_graph_relation" WHERE "project_id" = $1', [
      ids.project,
    ]);
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "memory_graph_relation" WHERE "project_id" = $1`,
      [ids.project],
    );
    expect(remaining.rows[0]?.count).toBe('0');
  });
});
