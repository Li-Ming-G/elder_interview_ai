import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PHYSICAL = JSON.parse(
  readFileSync(join(ROOT, 'docs/contracts/memory-persistence-p2c-physical-fk-v1.json'), 'utf8'),
) as PhysicalContract;
const MIGRATION_NAME = '20260820120000_memory_p2_c_persistence_runtime';
const MIGRATION_SQL = readFileSync(
  join(ROOT, 'apps/api/prisma/migrations', MIGRATION_NAME, 'migration.sql'),
  'utf8',
);

describe('MEMORY-T5-T8-P2-C-RUNTIME-001 migration', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => client.end());

  it('projects the exact 62-FK manifest and unique SET_NULL policy', async () => {
    const names = PHYSICAL.foreign_keys.map(({ name }) => name);
    expect(names).toHaveLength(62);
    const result = await client.query<ConstraintRow>(
      `SELECT c.conname AS name,
              child.relname AS from_table,
              parent.relname AS to_table,
              c.condeferrable AS deferrable,
              c.confdeltype AS delete_type,
              to_json(ARRAY(
                SELECT attribute.attname
                  FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute attribute
                    ON attribute.attrelid = c.conrelid AND attribute.attnum = key.attnum
                 ORDER BY key.position
              )) AS from_columns,
              to_json(ARRAY(
                SELECT attribute.attname
                  FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute attribute
                    ON attribute.attrelid = c.confrelid AND attribute.attnum = key.attnum
                 ORDER BY key.position
              )) AS to_columns,
              EXISTS (
                SELECT 1
                  FROM unnest(c.conkey) AS key(attnum)
                  JOIN pg_attribute attribute
                    ON attribute.attrelid = c.conrelid AND attribute.attnum = key.attnum
                 WHERE NOT attribute.attnotnull
              ) AS nullable
         FROM pg_constraint c
         JOIN pg_class child ON child.oid = c.conrelid
         JOIN pg_class parent ON parent.oid = c.confrelid
        WHERE c.contype = 'f' AND c.conname = ANY($1::text[])
        ORDER BY c.conname`,
      [names],
    );
    expect(result.rows).toHaveLength(62);
    const actual = new Map(result.rows.map((row) => [row.name, row]));
    for (const expected of PHYSICAL.foreign_keys) {
      const row = actual.get(expected.name);
      expect(row, expected.name).toMatchObject({
        deferrable: expected.deferrable,
        from_columns: expected.from_columns,
        from_table: expected.from_table,
        nullable: expected.nullable,
        to_columns: expected.to_columns,
        to_table: expected.to_table,
      });
      expect(deleteAction(row?.delete_type), expected.name).toBe(expected.on_delete);
    }
    expect(PHYSICAL.foreign_keys.filter(({ on_delete }) => on_delete === 'SET_NULL')).toEqual([
      expect.objectContaining({ name: 'memory_p2_retention_target_cleanup_job_fk' }),
    ]);
  });

  it('keeps fresh and repeated deployment state completed and fingerprinted', async () => {
    const before = await client.query<ManifestRow>(
      `SELECT manifest_id::text, mode, status, expected_migration_count,
              predecessor_fingerprint, completed_at::text
         FROM memory_p2_migration_manifest`,
    );
    expect(before.rows).toEqual([
      expect.objectContaining({
        expected_migration_count: 26,
        mode: 'fresh',
        predecessor_fingerprint: '2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6',
        status: 'completed',
      }),
    ]);
    await client.query('SELECT memory_p2_resume_migration()');
    const after = await client.query<ManifestRow>(
      `SELECT manifest_id::text, mode, status, expected_migration_count,
              predecessor_fingerprint, completed_at::text
         FROM memory_p2_migration_manifest`,
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('installs the durable lease, Long source-set and single-winner indexes', async () => {
    const constraints = await client.query<{ definition: string; name: string }>(
      `SELECT conname AS name, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = ANY($1::text[])
        ORDER BY conname`,
      [
        [
          'memory_long_job_projection_values_ck',
          'memory_p2_job_projection_lease_ck',
          'memory_p2_job_projection_source_matrix_ck',
        ],
      ],
    );
    expect(constraints.rows.map((row) => row.name)).toEqual([
      'memory_long_job_projection_values_ck',
      'memory_p2_job_projection_lease_ck',
      'memory_p2_job_projection_source_matrix_ck',
    ]);
    expect(constraints.rows[0]?.definition).toContain('source_session_ids');
    expect(constraints.rows[1]?.definition).toContain('recovery_lease_epoch');

    const indexes = await client.query<{ indexdef: string; indexname: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ANY($1::text[])
        ORDER BY indexname`,
      [
        [
          'ai_job_p2_live_trigger_dedupe_key',
          'ai_job_p2_trigger_attempt_key',
          'memory_p2_job_projection_final_mid_idx',
          'memory_p2_job_projection_recovery_lease_idx',
        ],
      ],
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'ai_job_p2_live_trigger_dedupe_key',
      'ai_job_p2_trigger_attempt_key',
      'memory_p2_job_projection_final_mid_idx',
      'memory_p2_job_projection_recovery_lease_idx',
    ]);
    expect(indexes.rows[0]?.indexdef).toContain('UNIQUE INDEX');
    expect(indexes.rows[1]?.indexdef).toContain('UNIQUE INDEX');
  });

  it('pins all 26 exact predecessor SQL checksums', () => {
    expect(PHYSICAL.migration_contract.predecessor.migrations).toHaveLength(26);
    for (const migration of PHYSICAL.migration_contract.predecessor.migrations) {
      const bytes = readFileSync(
        join(ROOT, 'apps/api/prisma/migrations', migration.id, 'migration.sql'),
      );
      expect(createHash('sha256').update(bytes).digest('hex'), migration.id).toBe(
        migration.migration_sql_sha256,
      );
    }
  });
});

describe('MEMORY-T5-T8-P2-C-RUNTIME-001 exact predecessor upgrade', () => {
  it('backfills in bounded batches and resumes an interrupted exact-26 upgrade', async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    const databaseName = `p2_upgrade_${randomUUID().replaceAll('-', '')}`;
    const adminUrl = databaseUrlFor(databaseUrl, 'postgres');
    const upgradeUrl = databaseUrlFor(databaseUrl, databaseName);
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    expect(databaseName.startsWith('p2_upgrade_')).toBe(true);
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const upgrade = new Client({ connectionString: upgradeUrl });
    try {
      await upgrade.connect();
      await upgrade.query(`CREATE TABLE "_prisma_migrations" (
          "id" VARCHAR(36) PRIMARY KEY,
          "checksum" VARCHAR(64) NOT NULL,
          "finished_at" TIMESTAMPTZ,
          "migration_name" VARCHAR(255) NOT NULL
        )`);
      for (const migration of PHYSICAL.migration_contract.predecessor.migrations) {
        const sql = readFileSync(
          join(ROOT, 'apps/api/prisma/migrations', migration.id, 'migration.sql'),
          'utf8',
        );
        await upgrade.query(sql);
        await upgrade.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name)
             VALUES ($1, $2, now(), $3)`,
          [randomUUID(), migration.migration_sql_sha256, migration.id],
        );
      }
      await seedLegacyAuthorities(upgrade);
      const splitAt = MIGRATION_SQL.indexOf('BEGIN;');
      expect(splitAt).toBeGreaterThan(0);
      await upgrade.query(MIGRATION_SQL.slice(0, splitAt));
      await upgrade.query(MIGRATION_SQL.slice(splitAt));
      const interrupted = await upgrade.query<{ last_resolution_id: string; status: string }>(
        `SELECT last_resolution_id::text, status FROM memory_p2_migration_manifest`,
      );
      expect(interrupted.rows).toHaveLength(1);
      expect(typeof interrupted.rows[0]?.last_resolution_id).toBe('string');
      expect(interrupted.rows[0]?.status).toBe('upgrading');
      expect(
        (
          await upgrade.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM memory_resolution WHERE authority_id IS NOT NULL`,
          )
        ).rows[0]?.count,
      ).toBe('500');
      await upgrade.query(
        `UPDATE memory_p2_migration_manifest
              SET status='interrupted', error_code='TEST_INTERRUPTED'
            WHERE status='upgrading'`,
      );
      await upgrade.query('SELECT memory_p2_resume_migration()');
      expect(
        (
          await upgrade.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM memory_resolution WHERE authority_id IS NOT NULL`,
          )
        ).rows[0]?.count,
      ).toBe('600');
      const completed = await upgrade.query<ManifestRow>(
        `SELECT manifest_id::text, mode, status, expected_migration_count,
                  predecessor_fingerprint, completed_at::text
             FROM memory_p2_migration_manifest`,
      );
      expect(completed.rows).toEqual([
        expect.objectContaining({ mode: 'upgrade', status: 'completed' }),
      ]);
      await upgrade.query('SELECT memory_p2_resume_migration()');
      expect(
        (
          await upgrade.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM memory_resolution_authority`,
          )
        ).rows[0]?.count,
      ).toBe('600');
    } finally {
      await upgrade.end().catch(() => undefined);
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);
});

async function seedLegacyAuthorities(client: InstanceType<typeof Client>): Promise<void> {
  const userId = randomUUID();
  const projectId = randomUUID();
  const sessionId = randomUUID();
  const threadId = randomUUID();
  const retentionRootId = randomUUID();
  await client.query(
    `INSERT INTO "user" (id,email,display_name,password_hash,role,updated_at)
     VALUES ($1,$2,'P2 migration fixture','test-only','interviewer',now())`,
    [userId, `p2-${userId}@example.test`],
  );
  await client.query(
    `INSERT INTO elder_project (id,display_name,created_by,updated_at)
     VALUES ($1,'P2 fixture',$2,now())`,
    [projectId, userId],
  );
  await client.query(
    `INSERT INTO interview_session (id,project_id,sequence_no,status,created_by,updated_at)
     VALUES ($1,$2,1,'completed',$3,now())`,
    [sessionId, projectId, userId],
  );
  await client.query(
    `INSERT INTO memory_thread (id,project_id,origin_session_id) VALUES ($1,$2,$3)`,
    [threadId, projectId, sessionId],
  );
  await client.query(
    `INSERT INTO memory_retention_root
      (id,project_id,source_kind,source_operation_id,retention_policy_version,expires_at)
     VALUES ($1,$2,'system_migration',$3,1,now() + interval '1 day')`,
    [retentionRootId, projectId, randomUUID()],
  );
  await client.query(
    `INSERT INTO memory_resolution
      (id,project_id,memory_retention_root_id,canonical_key,resolution_revision,resolution_kind,
       resolved_value_json,authority,status,semantic_kind,layer,semantic_status,provenance_state,
       source_session_id,thread_id)
     SELECT gen_random_uuid(), $1, $2, 'fact:upgrade:' || lpad(i::text, 4, '0'), 1, 'single',
            jsonb_build_object('value', i), 'system_migration', 'current', 'fact', 'working',
            'current', 'active', $3, $4
       FROM generate_series(1,600) AS i`,
    [projectId, retentionRootId, sessionId, threadId],
  );
}

function databaseUrlFor(value: string, databaseName: string): string {
  const url = new URL(value);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function deleteAction(code: string | undefined): string | undefined {
  return { a: 'RESTRICT', c: 'CASCADE', n: 'SET_NULL', r: 'RESTRICT' }[code ?? ''];
}

interface ConstraintRow {
  deferrable: boolean;
  delete_type: string;
  from_columns: string[];
  from_table: string;
  name: string;
  nullable: boolean;
  to_columns: string[];
  to_table: string;
}

interface ManifestRow {
  completed_at: string | null;
  expected_migration_count: number;
  manifest_id: string;
  mode: string;
  predecessor_fingerprint: string;
  status: string;
}

interface PhysicalContract {
  foreign_keys: Array<{
    deferrable: boolean;
    from_columns: string[];
    from_table: string;
    name: string;
    nullable: boolean;
    on_delete: string;
    to_columns: string[];
    to_table: string;
  }>;
  migration_contract: {
    predecessor: {
      migrations: Array<{ id: string; migration_sql_sha256: string }>;
    };
  };
}
