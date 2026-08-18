import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

interface DatabaseClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const requireFromApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = requireFromApi('pg') as {
  Client: new (options: { connectionString: string }) => DatabaseClient;
};
const migrationsDirectory = fileURLToPath(
  new URL('../../apps/api/prisma/migrations/', import.meta.url),
);
const targetMigration = '20260818100000_memory_maintainer_v1_2_semantic_trigger';
const traceObservationMigration = '20260818101000_decision_trace_memory_trigger_observation';
const baselineMigration = '20260817130000_memory_maintainer_review_fixes';
const historicalDigests = new Map([
  [
    '20260817121000_memory_maintainer_v1_1_runtime',
    'ae706773fdaab6c30c3a321c1d30bddff29a60aff035ae37bf27b6e63b174bfc',
  ],
  [
    '20260817130000_memory_maintainer_review_fixes',
    'ec04ff238a116fb7eccef10941d57f0d53ffffdc64b709575525112f01acbe9d',
  ],
]);

it('upgrades the exact v1.1 state without rewriting legacy identity or requiring a P1 tag', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');

  const client = new Client({ connectionString: databaseUrl });
  const schemaName = `memory_v12_${randomUUID().replaceAll('-', '')}`;
  const quotedSchema = `"${schemaName}"`;
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}, public`);

    const migrationNames = (await readdir(migrationsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const targetIndex = migrationNames.indexOf(targetMigration);
    expect(targetIndex).toBeGreaterThan(0);
    expect(migrationNames[targetIndex - 1]).toBe(baselineMigration);
    expect(migrationNames[targetIndex + 1]).toBe(traceObservationMigration);

    for (const [migrationName, expectedDigest] of historicalDigests) {
      const bytes = await readFile(join(migrationsDirectory, migrationName, 'migration.sql'));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedDigest);
    }

    for (const migrationName of migrationNames.slice(0, targetIndex)) {
      await client.query(
        await readFile(join(migrationsDirectory, migrationName, 'migration.sql'), 'utf8'),
      );
    }

    const ids = {
      legacyClaim: randomUUID(),
      legacyResolution: randomUUID(),
      p1Claim: randomUUID(),
      p1Resolution: randomUUID(),
      project: randomUUID(),
      retentionRoot: randomUUID(),
      session: randomUUID(),
      thread: randomUUID(),
      user: randomUUID(),
    };
    await client.query(
      `INSERT INTO "user"
          ("id", "email", "display_name", "password_hash", "role", "status", "updated_at")
         VALUES ($1, $2, 'Fictional migration listener', 'test-only', 'interviewer', 'active', now())`,
      [ids.user, `memory-v12-${ids.user}@example.test`],
    );
    await client.query(
      `INSERT INTO "elder_project" ("id", "display_name", "created_by", "updated_at")
         VALUES ($1, 'Fictional migration project', $2, now())`,
      [ids.project, ids.user],
    );
    await client.query(
      `INSERT INTO "interview_session"
          ("id", "project_id", "sequence_no", "created_by", "updated_at")
         VALUES ($1, $2, 1, $3, now())`,
      [ids.session, ids.project, ids.user],
    );
    await client.query(
      `INSERT INTO "memory_retention_root"
          ("id", "project_id", "source_kind", "source_operation_id",
           "retention_policy_version", "expires_at")
         VALUES ($1, $2, 'system_migration', $3, 1, '2035-01-01T00:00:00.000Z')`,
      [ids.retentionRoot, ids.project, randomUUID()],
    );
    await client.query(
      `INSERT INTO "memory_thread"
          ("id", "project_id", "origin_session_id")
         VALUES ($1, $2, $3)`,
      [ids.thread, ids.project, ids.session],
    );
    await client.query(
      `INSERT INTO "memory_claim"
          ("id", "project_id", "memory_retention_root_id", "memory_type", "canonical_key",
           "value_kind", "value_json", "normalized_value_digest", "authority")
         VALUES ($1, $2, $3, 'event', 'legacy.sentinel', 'exact',
                 '{"value":"legacy-sentinel","year":1949}'::jsonb, $4, 'system_migration')`,
      [ids.legacyClaim, ids.project, ids.retentionRoot, 'a'.repeat(64)],
    );
    await client.query(
      `INSERT INTO "memory_resolution"
          ("id", "project_id", "memory_retention_root_id", "memory_type", "canonical_key",
           "resolution_revision", "resolution_kind", "resolved_value_json", "authority", "status")
         VALUES ($1, $2, $3, 'event', 'legacy.sentinel', 1, 'single',
                 '{"value":"legacy-sentinel","year":1949}'::jsonb, 'system_migration', 'current')`,
      [ids.legacyResolution, ids.project, ids.retentionRoot],
    );

    const legacyBefore = await legacyBytes(client, ids.legacyClaim, ids.legacyResolution);
    await client.query(
      await readFile(join(migrationsDirectory, targetMigration, 'migration.sql'), 'utf8'),
    );
    await client.query(
      await readFile(join(migrationsDirectory, traceObservationMigration, 'migration.sql'), 'utf8'),
    );

    expect(await legacyBytes(client, ids.legacyClaim, ids.legacyResolution)).toEqual(legacyBefore);
    const nullableColumns = await client.query(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name IN ('memory_claim', 'memory_resolution')
           AND column_name = 'memory_type'
         ORDER BY table_name`,
      [schemaName],
    );
    expect(
      nullableColumns.rows.map((row) => ({
        column_name: String(row.column_name),
        is_nullable: String(row.is_nullable),
      })),
    ).toEqual([
      { column_name: 'memory_type', is_nullable: 'YES' },
      { column_name: 'memory_type', is_nullable: 'YES' },
    ]);

    const resolutionIndexes = await client.query(
      `SELECT indexname
         FROM pg_indexes
         WHERE schemaname = $1 AND tablename = 'memory_resolution'`,
      [schemaName],
    );
    const indexNames = new Set(resolutionIndexes.rows.map(({ indexname }) => String(indexname)));
    for (const expectedName of [
      'memory_resolution_legacy_slot_revision_key',
      'memory_resolution_p1_slot_revision_key',
      'memory_resolution_legacy_current_slot_key',
      'memory_resolution_p1_current_slot_key',
    ]) {
      expect(indexNames.has(expectedName)).toBe(true);
    }
    expect(indexNames.has('memory_resolution_project_id_memory_type_canonical_key_reso_key')).toBe(
      false,
    );
    expect(indexNames.has('memory_resolution_one_current_slot_key')).toBe(false);
    const traceTables = await client.query(
      `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1
           AND table_name IN (
             'decision_trace_memory_trigger_observation',
             'decision_trace_memory_trigger_segment_membership'
           )
         ORDER BY table_name`,
      [schemaName],
    );
    expect(traceTables.rows.map(({ table_name }) => String(table_name))).toEqual([
      'decision_trace_memory_trigger_observation',
      'decision_trace_memory_trigger_segment_membership',
    ]);

    await client.query(
      `INSERT INTO "memory_claim"
          ("id", "project_id", "memory_retention_root_id", "canonical_key", "value_kind",
           "value_json", "normalized_value_digest", "authority", "semantic_kind", "layer",
           "provenance_state", "source_session_id", "thread_id")
         VALUES ($1, $2, $3, 'shared.semantic.slot', 'exact', '{"value":"untagged"}'::jsonb,
                 $4, 'system_migration', 'fact', 'working', 'active', $5, $6)`,
      [ids.p1Claim, ids.project, ids.retentionRoot, 'b'.repeat(64), ids.session, ids.thread],
    );
    await insertP1Resolution(client, {
      canonicalKey: 'shared.semantic.slot',
      id: ids.p1Resolution,
      memoryType: null,
      projectId: ids.project,
      retentionRootId: ids.retentionRoot,
      revision: 1,
      sessionId: ids.session,
      status: 'current',
      threadId: ids.thread,
    });

    await expect(
      insertP1Resolution(client, {
        canonicalKey: 'shared.semantic.slot',
        id: randomUUID(),
        memoryType: 'event',
        projectId: ids.project,
        retentionRootId: ids.retentionRoot,
        revision: 1,
        sessionId: ids.session,
        status: 'superseded',
        threadId: ids.thread,
      }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertP1Resolution(client, {
        canonicalKey: 'shared.semantic.slot',
        id: randomUUID(),
        memoryType: 'place',
        projectId: ids.project,
        retentionRootId: ids.retentionRoot,
        revision: 2,
        sessionId: ids.session,
        status: 'current',
        threadId: ids.thread,
      }),
    ).rejects.toMatchObject({ code: '23505' });
    await insertP1Resolution(client, {
      canonicalKey: 'shared.semantic.slot',
      id: randomUUID(),
      memoryType: 'place',
      projectId: ids.project,
      retentionRootId: ids.retentionRoot,
      revision: 2,
      sessionId: ids.session,
      status: 'superseded',
      threadId: ids.thread,
    });

    await expect(
      client.query(
        `INSERT INTO "memory_resolution"
            ("id", "project_id", "memory_retention_root_id", "canonical_key",
             "resolution_revision", "resolution_kind", "resolved_value_json", "authority", "status")
           VALUES ($1, $2, $3, 'legacy.missing-type', 1, 'single',
                   '{"value":"invalid"}'::jsonb, 'system_migration', 'current')`,
        [randomUUID(), ids.project, ids.retentionRoot],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query(
        `INSERT INTO "memory_resolution"
            ("id", "project_id", "memory_retention_root_id", "memory_type", "canonical_key",
             "resolution_revision", "resolution_kind", "resolved_value_json", "authority", "status")
           VALUES ($1, $2, $3, 'event', 'legacy.sentinel', 1, 'single',
                   '{"value":"duplicate"}'::jsonb, 'system_migration', 'superseded')`,
        [randomUUID(), ids.project, ids.retentionRoot],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const v11JobId = await insertAiJob(
      client,
      ids,
      `memory-p1-v1.1:${ids.session}:historical`,
      'working_memory_maintain',
    );
    const v12JobId = await insertAiJob(
      client,
      ids,
      `memory-p1-v1.2:${ids.session}:current`,
      'working_memory_maintain',
    );
    expect(v11JobId).not.toBe(v12JobId);
    const traceId = randomUUID();
    await client.query(
      `INSERT INTO "decision_trace"
        ("id", "project_id", "session_id", "owner_actor_id", "request_id", "generation_id",
         "ai_job_id", "trigger_type", "decision_outcome", "director_invoked", "status",
         "started_at", "context_revision", "input_hash", "stage_timings_json", "expires_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'working_memory_maintain', 'unavailable', false,
               'unavailable', now(), 0, $8, '{}'::jsonb, '2035-01-01T00:00:00.000Z')`,
      [
        traceId,
        ids.project,
        ids.session,
        ids.user,
        randomUUID(),
        randomUUID(),
        v12JobId,
        'e'.repeat(64),
      ],
    );
    await expect(
      client.query(
        `INSERT INTO "decision_trace_memory_trigger_observation"
          ("id", "trace_id", "ai_job_id", "observation_version",
           "useful_character_policy_version", "trigger_identity", "trigger_kind",
           "selected_new_segment_count", "cumulative_useful_characters",
           "minimum_useful_characters", "selected_new_manifest_hash")
         VALUES ($1, $2, $3, 'decision-trace-memory-trigger-v1',
                 'memory-useful-characters-nfkc-ws-codepoint-v1', $4,
                 'session_final_flush', 0, 0, 0, $5)`,
        [randomUUID(), traceId, v12JobId, `memory-p1-v1.2:${ids.session}:current`, '0'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    for (const version of ['v1.1', 'v1.2']) {
      await expect(
        insertAiJob(
          client,
          ids,
          `memory-p1-${version}:${ids.session}:non-maintainer`,
          'memory_extract',
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }

    await client.query(
      `INSERT INTO "memory_working_snapshot"
          ("id", "ai_job_id", "project_id", "source_session_id", "contract_version",
           "trigger_kind", "trigger_identity", "policy_revision",
           "expected_resolution_count", "resolution_manifest_hash", "expected_thread_count",
           "thread_manifest_hash", "expected_boundary_count", "boundary_manifest_hash")
         VALUES ($1, $2, $3, $4, 'memory-maintainer-v1.2', 'batch_threshold', $5, 0,
                 0, $6, 0, $6, 0, $6)`,
      [randomUUID(), v12JobId, ids.project, ids.session, randomUUID(), '0'.repeat(64)],
    );
    expect(
      await client.query(
        `SELECT count(*)::int AS count FROM "memory_working_snapshot"
           WHERE "contract_version" = 'memory-maintainer-v1.2'`,
      ),
    ).toMatchObject({ rows: [{ count: 1 }] });
  } finally {
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await client.end();
  }
}, 60_000);

async function legacyBytes(
  client: DatabaseClient,
  claimId: string,
  resolutionId: string,
): Promise<Record<string, string>> {
  const result = await client.query(
    `SELECT
       c."memory_type"::text AS claim_memory_type,
       c."canonical_key" AS claim_canonical_key,
       encode(jsonb_send(c."value_json"), 'hex') AS claim_value_bytes,
       r."memory_type"::text AS resolution_memory_type,
       r."canonical_key" AS resolution_canonical_key,
       encode(jsonb_send(r."resolved_value_json"), 'hex') AS resolution_value_bytes
     FROM "memory_claim" c
     CROSS JOIN "memory_resolution" r
     WHERE c."id" = $1 AND r."id" = $2`,
    [claimId, resolutionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('legacy sentinel missing');
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)]));
}

async function insertP1Resolution(
  client: DatabaseClient,
  input: {
    canonicalKey: string;
    id: string;
    memoryType: 'event' | 'place' | null;
    projectId: string;
    retentionRootId: string;
    revision: number;
    sessionId: string;
    status: 'current' | 'superseded';
    threadId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO "memory_resolution"
      ("id", "project_id", "memory_retention_root_id", "memory_type", "canonical_key",
       "resolution_revision", "resolution_kind", "resolved_value_json", "authority", "status",
       "semantic_kind", "layer", "semantic_status", "provenance_state",
       "source_session_id", "thread_id")
     VALUES ($1, $2, $3, $4::"MemoryType", $5, $6, 'single', '{"value":"p1"}'::jsonb,
             'system_migration', $7::"MemoryResolutionStatus", 'fact', 'working', 'current',
             'active', $8, $9)`,
    [
      input.id,
      input.projectId,
      input.retentionRootId,
      input.memoryType,
      input.canonicalKey,
      input.revision,
      input.status,
      input.sessionId,
      input.threadId,
    ],
  );
}

async function insertAiJob(
  client: DatabaseClient,
  ids: { project: string; user: string },
  triggerDedupeKey: string,
  jobType: 'memory_extract' | 'working_memory_maintain',
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO "ai_job"
      ("id", "project_id", "requested_by", "request_id", "trigger_dedupe_key",
       "request_identity_hash", "input_hash", "job_type", "status", "model_name",
       "prompt_version", "schema_version", "context_builder_version", "policy_revision",
       "retention_policy_version", "expires_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::"AiJobType", 'failed', 'local-test',
             'memory-maintainer-v1.2', 'memory-maintainer-v1.2', 'memory-maintainer-v1.2',
             0, 1, '2035-01-01T00:00:00.000Z')`,
    [
      id,
      ids.project,
      ids.user,
      randomUUID(),
      triggerDedupeKey,
      'c'.repeat(64),
      'd'.repeat(64),
      jobType,
    ],
  );
  return id;
}
