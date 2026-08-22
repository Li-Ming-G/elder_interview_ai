-- P2C-01-DATABASE
-- Forward-only P2 persistence substrate. Semantic values remain owned exclusively by
-- memory_claim and memory_resolution; every new table below is reference/provenance only.

ALTER TYPE "AiJobType" ADD VALUE IF NOT EXISTS 'mid_online';
ALTER TYPE "AiJobType" ADD VALUE IF NOT EXISTS 'mid_final';
ALTER TYPE "AiJobType" ADD VALUE IF NOT EXISTS 'long_session_end';
ALTER TYPE "AiJobStatus" ADD VALUE IF NOT EXISTS 'unavailable';

BEGIN;

ALTER TABLE "memory_claim"
  ADD COLUMN "claim_revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "memory_claim"
  ADD CONSTRAINT "memory_claim_revision_v1_ck" CHECK ("claim_revision" = 1);

ALTER TABLE "memory_claim_evidence"
  ADD COLUMN "evidence_id" UUID,
  ADD COLUMN "authority_revision" INTEGER;
ALTER TABLE "memory_claim_evidence"
  ADD CONSTRAINT "memory_claim_evidence_authority_pair_ck"
  CHECK (("evidence_id" IS NULL) = ("authority_revision" IS NULL));

ALTER TABLE "memory_resolution"
  ADD COLUMN "authority_id" UUID,
  ADD COLUMN "p2_write" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "memory_resolution"
  ADD CONSTRAINT "memory_resolution_p2_authority_required_ck"
  CHECK (NOT "p2_write" OR "authority_id" IS NOT NULL);

ALTER TABLE "decision_trace"
  ADD COLUMN "trace_kind" VARCHAR(32) NOT NULL DEFAULT 'question_orchestration',
  ADD COLUMN "memory_outcome" VARCHAR(32);

CREATE TABLE "memory_resolution_authority" (
  "authority_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "semantic_kind" "MemorySemanticKind" NOT NULL,
  "canonical_key" VARCHAR(240) NOT NULL,
  "origin_session_id" UUID NOT NULL,
  "origin_thread_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_resolution_authority_pkey" PRIMARY KEY ("authority_id"),
  CONSTRAINT "memory_resolution_authority_slot_key" UNIQUE ("project_id", "semantic_kind", "canonical_key")
);

CREATE TABLE "memory_evidence_authority" (
  "evidence_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "source_kind" VARCHAR(32) NOT NULL,
  "source_id" UUID NOT NULL,
  "authority_revision" INTEGER NOT NULL DEFAULT 1,
  "membership_digest" CHAR(64) NOT NULL,
  "transcript_text_revision" INTEGER NOT NULL,
  "speaker_role_revision" INTEGER NOT NULL,
  "effective_text_digest" CHAR(64) NOT NULL,
  "input_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_evidence_authority_pkey" PRIMARY KEY ("evidence_id"),
  CONSTRAINT "memory_evidence_authority_revision_key" UNIQUE ("evidence_id", "authority_revision"),
  CONSTRAINT "memory_evidence_authority_source_key" UNIQUE ("project_id", "session_id", "source_kind", "source_id", "authority_revision"),
  CONSTRAINT "memory_evidence_authority_source_kind_ck" CHECK ("source_kind" = 'transcript_segment'),
  CONSTRAINT "memory_evidence_authority_revision_v1_ck" CHECK ("authority_revision" = 1),
  CONSTRAINT "memory_evidence_authority_revision_nonnegative_ck" CHECK ("transcript_text_revision" >= 0 AND "speaker_role_revision" >= 0),
  CONSTRAINT "memory_evidence_authority_digest_ck" CHECK ("membership_digest" ~ '^[0-9a-f]{64}$' AND "effective_text_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "memory_evidence_bridge" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "claim_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  "authority_revision" INTEGER NOT NULL,
  "ai_job_input_segment_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_evidence_bridge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_evidence_bridge_pair_key" UNIQUE ("claim_id", "evidence_id", "authority_revision"),
  CONSTRAINT "memory_evidence_bridge_input_key" UNIQUE ("claim_id", "ai_job_input_segment_id")
);

CREATE TABLE "memory_evolution_checkpoint" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "root_identity" CHAR(64) NOT NULL,
  "project_id" UUID NOT NULL,
  "source_session_id" UUID NOT NULL,
  "trigger_kind" VARCHAR(40) NOT NULL,
  "trigger_identity" VARCHAR(160) NOT NULL,
  "p2_producer_job_id" UUID NOT NULL,
  "ai_policy_revision" INTEGER NOT NULL,
  "retention_policy_version" INTEGER NOT NULL,
  "p2_policy_contract_revision" VARCHAR(80) NOT NULL,
  "p2_retention_contract_version" VARCHAR(80) NOT NULL,
  "deletion_scope_digest" CHAR(64) NOT NULL,
  "deletion_scope_policy_revision" INTEGER NOT NULL,
  "source_working_snapshot_id" UUID NOT NULL,
  "source_working_snapshot_contract_version" VARCHAR(80) NOT NULL,
  "source_resolution_manifest_hash" CHAR(64) NOT NULL,
  "source_thread_manifest_hash" CHAR(64) NOT NULL,
  "source_boundary_manifest_hash" CHAR(64) NOT NULL,
  "source_thread_id" UUID NOT NULL,
  "source_thread_revision_id" UUID NOT NULL,
  "source_thread_revision" INTEGER NOT NULL,
  "source_thread_status" VARCHAR(24) NOT NULL,
  "source_p1_terminal_job_id" UUID,
  "source_p1_terminal_status" VARCHAR(24),
  "source_p1_terminal_outcome" VARCHAR(80),
  "source_set_kind" VARCHAR(40) NOT NULL,
  "mid_expected_count" INTEGER NOT NULL DEFAULT 0,
  "mid_manifest_hash" CHAR(64),
  "current_expected_count" INTEGER NOT NULL DEFAULT 0,
  "current_manifest_hash" CHAR(64),
  "expected_member_count" INTEGER NOT NULL,
  "member_manifest_hash" CHAR(64) NOT NULL,
  "evidence_manifest_hash" CHAR(64) NOT NULL,
  "manifest_algorithm_version" VARCHAR(80) NOT NULL,
  "lifecycle_status" VARCHAR(24) NOT NULL,
  "committed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_evolution_checkpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_evolution_checkpoint_root_key" UNIQUE ("root_identity"),
  CONSTRAINT "memory_evolution_checkpoint_trigger_key" UNIQUE ("trigger_identity"),
  CONSTRAINT "memory_evolution_checkpoint_job_key" UNIQUE ("p2_producer_job_id"),
  CONSTRAINT "memory_checkpoint_trigger_kind_ck" CHECK ("trigger_kind" IN ('semantic_park', 'capacity_checkpoint', 'session_final_flush')),
  CONSTRAINT "memory_checkpoint_source_set_kind_ck" CHECK ("source_set_kind" IN ('working_checkpoint', 'final_mid_and_current')),
  CONSTRAINT "memory_checkpoint_source_matrix_ck" CHECK (
    ("trigger_kind" IN ('semantic_park', 'capacity_checkpoint') AND "source_p1_terminal_job_id" IS NULL AND "source_p1_terminal_status" IS NULL AND "source_p1_terminal_outcome" IS NULL AND "source_set_kind" = 'working_checkpoint' AND "mid_expected_count" = 0 AND "mid_manifest_hash" IS NULL AND "current_expected_count" = 0 AND "current_manifest_hash" IS NULL)
    OR
    ("trigger_kind" = 'session_final_flush' AND "source_p1_terminal_job_id" IS NOT NULL AND "source_p1_terminal_status" = 'succeeded' AND "source_p1_terminal_outcome" IS NOT NULL AND "source_set_kind" = 'final_mid_and_current')
  ),
  CONSTRAINT "memory_checkpoint_v12_final_ck" CHECK ("trigger_kind" <> 'session_final_flush' OR "source_working_snapshot_contract_version" = 'memory-maintainer-v1.2'),
  CONSTRAINT "memory_checkpoint_counts_ck" CHECK ("expected_member_count" > 0 AND "mid_expected_count" >= 0 AND "current_expected_count" >= 0 AND "source_thread_revision" > 0),
  CONSTRAINT "memory_checkpoint_status_ck" CHECK ("lifecycle_status" IN ('frozen', 'committed', 'hidden', 'purging', 'cleanup_failed')),
  CONSTRAINT "memory_checkpoint_digest_ck" CHECK ("root_identity" ~ '^[0-9a-f]{64}$' AND "deletion_scope_digest" ~ '^[0-9a-f]{64}$' AND "member_manifest_hash" ~ '^[0-9a-f]{64}$' AND "evidence_manifest_hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "memory_evolution_checkpoint_member" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "checkpoint_id" UUID NOT NULL,
  "resolution_row_id" UUID NOT NULL,
  "resolution_authority_id" UUID NOT NULL,
  "resolution_revision" INTEGER NOT NULL,
  "semantic_status" "MemorySemanticStatus" NOT NULL,
  "claim_count" INTEGER NOT NULL,
  "boundary_status" VARCHAR(24) NOT NULL,
  "membership_digest" CHAR(64) NOT NULL,
  "input_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_evolution_checkpoint_member_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_checkpoint_member_authority_key" UNIQUE ("checkpoint_id", "resolution_authority_id"),
  CONSTRAINT "memory_checkpoint_member_order_key" UNIQUE ("checkpoint_id", "input_order"),
  CONSTRAINT "memory_checkpoint_member_values_ck" CHECK ("resolution_revision" > 0 AND "claim_count" > 0 AND "input_order" >= 0 AND "boundary_status" IN ('none', 'active', 'revoked', 'superseded') AND "membership_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "memory_layer_identity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "origin_session_id" UUID NOT NULL,
  "origin_thread_id" UUID NOT NULL,
  "origin_resolution_authority_id" UUID NOT NULL,
  "identity_key_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_layer_identity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_layer_identity_tuple_key" UNIQUE ("project_id", "origin_session_id", "origin_thread_id", "origin_resolution_authority_id"),
  CONSTRAINT "memory_layer_identity_digest_key" UNIQUE ("identity_key_digest"),
  CONSTRAINT "memory_layer_identity_digest_ck" CHECK ("identity_key_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "memory_layer_revision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "identity_id" UUID NOT NULL,
  "layer" "MemoryLayer" NOT NULL,
  "revision_no" INTEGER NOT NULL,
  "lifecycle_status" VARCHAR(24) NOT NULL,
  "project_id" UUID NOT NULL,
  "source_session_id" UUID NOT NULL,
  "source_checkpoint_id" UUID NOT NULL,
  "source_job_id" UUID NOT NULL,
  "resolution_row_id" UUID NOT NULL,
  "resolution_authority_id" UUID NOT NULL,
  "resolution_revision" INTEGER NOT NULL,
  "semantic_status" "MemorySemanticStatus" NOT NULL,
  "predecessor_revision_id" UUID,
  "expected_member_count" INTEGER NOT NULL,
  "member_manifest_hash" CHAR(64) NOT NULL,
  "manifest_algorithm_version" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_layer_revision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_layer_revision_number_key" UNIQUE ("identity_id", "revision_no"),
  CONSTRAINT "memory_layer_revision_predecessor_key" UNIQUE ("predecessor_revision_id"),
  CONSTRAINT "memory_layer_revision_layer_ck" CHECK ("layer" IN ('mid', 'long')),
  CONSTRAINT "memory_layer_revision_lifecycle_ck" CHECK ("lifecycle_status" IN ('pending', 'current', 'superseded', 'hidden', 'purging', 'cleanup_failed')),
  CONSTRAINT "memory_layer_revision_values_ck" CHECK ("revision_no" > 0 AND "resolution_revision" > 0 AND "expected_member_count" > 0 AND "member_manifest_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "memory_layer_revision_predecessor_shape_ck" CHECK (("revision_no" = 1 AND "predecessor_revision_id" IS NULL) OR ("revision_no" > 1 AND "predecessor_revision_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "memory_layer_revision_current_identity_key"
  ON "memory_layer_revision" ("identity_id") WHERE "lifecycle_status" = 'current';

CREATE TABLE "memory_layer_revision_member" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "revision_id" UUID NOT NULL,
  "memory_claim_id" UUID NOT NULL,
  "claim_revision" INTEGER NOT NULL,
  "role" VARCHAR(24) NOT NULL,
  "input_order" INTEGER NOT NULL,
  "evidence_membership_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_layer_revision_member_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_layer_revision_member_claim_key" UNIQUE ("revision_id", "memory_claim_id"),
  CONSTRAINT "memory_layer_revision_member_order_key" UNIQUE ("revision_id", "input_order"),
  CONSTRAINT "memory_layer_revision_member_values_ck" CHECK ("claim_revision" = 1 AND "role" IN ('primary', 'supporting', 'conflicting', 'superseded') AND "input_order" >= 0 AND "evidence_membership_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "memory_long_job_projection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ai_job_id" UUID NOT NULL,
  "target_layer_revision_id" UUID NOT NULL,
  "source_final_checkpoint_id" UUID NOT NULL,
  "source_mid_manifest_hash" CHAR(64) NOT NULL,
  "source_session_ids" UUID[] NOT NULL,
  "source_session_set_hash" CHAR(64) NOT NULL,
  "deletion_scope_digest" CHAR(64) NOT NULL,
  "expected_source_count" INTEGER NOT NULL,
  "source_manifest_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_long_job_projection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_long_job_projection_job_key" UNIQUE ("ai_job_id"),
  CONSTRAINT "memory_long_job_projection_target_key" UNIQUE ("target_layer_revision_id"),
  CONSTRAINT "memory_long_job_projection_values_ck" CHECK ("expected_source_count" > 0 AND cardinality("source_session_ids") > 0 AND "source_mid_manifest_hash" ~ '^[0-9a-f]{64}$' AND "source_session_set_hash" ~ '^[0-9a-f]{64}$' AND "source_manifest_hash" ~ '^[0-9a-f]{64}$' AND "deletion_scope_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "memory_long_job_projection_source" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projection_id" UUID NOT NULL,
  "source_session_id" UUID NOT NULL,
  "source_mid_revision_id" UUID NOT NULL,
  "membership_digest" CHAR(64) NOT NULL,
  "input_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_long_job_projection_source_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_long_projection_source_revision_key" UNIQUE ("projection_id", "source_session_id", "source_mid_revision_id"),
  CONSTRAINT "memory_long_projection_source_order_key" UNIQUE ("projection_id", "input_order"),
  CONSTRAINT "memory_long_projection_source_values_ck" CHECK ("input_order" >= 0 AND "membership_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "memory_p2_job_projection" (
  "ai_job_id" UUID NOT NULL,
  "job_kind" VARCHAR(32) NOT NULL,
  "trigger_identity_hash" CHAR(64) NOT NULL,
  "source_checkpoint_id" UUID,
  "source_final_mid_checkpoint_id" UUID,
  "source_p1_terminal_job_id" UUID,
  "source_working_snapshot_id" UUID,
  "source_thread_revision_id" UUID,
  "source_revision_digest" CHAR(64) NOT NULL,
  "deletion_scope_digest" CHAR(64) NOT NULL,
  "deletion_scope_policy_revision" INTEGER NOT NULL,
  "p2_policy_revision" VARCHAR(80) NOT NULL,
  "p2_retention_policy_version" VARCHAR(80) NOT NULL,
  "p2_policy_contract_revision" VARCHAR(80) NOT NULL,
  "p2_retention_contract_version" VARCHAR(80) NOT NULL,
  "target_slot_digest" CHAR(64) NOT NULL,
  "target_layer_identity_id" UUID,
  "target_layer_revision_id" UUID,
  "target_revision_digest" CHAR(64),
  "terminal_error_code" VARCHAR(80),
  "recovery_lease_owner" VARCHAR(120) NOT NULL,
  "recovery_lease_epoch" INTEGER NOT NULL,
  "recovery_lease_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_p2_job_projection_pkey" PRIMARY KEY ("ai_job_id"),
  CONSTRAINT "memory_p2_job_projection_kind_ck" CHECK ("job_kind" IN ('mid_online', 'mid_final', 'long_session_end')),
  CONSTRAINT "memory_p2_job_projection_digest_ck" CHECK ("trigger_identity_hash" ~ '^[0-9a-f]{64}$' AND "source_revision_digest" ~ '^[0-9a-f]{64}$' AND "deletion_scope_digest" ~ '^[0-9a-f]{64}$' AND "target_slot_digest" ~ '^[0-9a-f]{64}$' AND ("target_revision_digest" IS NULL OR "target_revision_digest" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "memory_p2_job_projection_lease_ck" CHECK ("recovery_lease_epoch" >= 1 AND length(btrim("recovery_lease_owner")) > 0),
  CONSTRAINT "memory_p2_job_projection_source_matrix_ck" CHECK (
    ("job_kind" = 'mid_online' AND "source_working_snapshot_id" IS NOT NULL AND "source_thread_revision_id" IS NOT NULL AND "source_p1_terminal_job_id" IS NULL AND "source_final_mid_checkpoint_id" IS NULL)
    OR ("job_kind" = 'mid_final' AND "source_working_snapshot_id" IS NOT NULL AND "source_thread_revision_id" IS NOT NULL AND "source_p1_terminal_job_id" IS NOT NULL AND "source_final_mid_checkpoint_id" IS NULL)
    OR ("job_kind" = 'long_session_end' AND "source_final_mid_checkpoint_id" IS NOT NULL AND "source_p1_terminal_job_id" IS NOT NULL)
  )
);

CREATE INDEX "memory_p2_job_projection_trigger_idx" ON "memory_p2_job_projection" ("job_kind", "trigger_identity_hash");
CREATE INDEX "memory_p2_job_projection_checkpoint_idx" ON "memory_p2_job_projection" ("source_checkpoint_id");
CREATE INDEX "memory_p2_job_projection_final_mid_idx" ON "memory_p2_job_projection" ("source_final_mid_checkpoint_id");
CREATE INDEX "memory_p2_job_projection_recovery_lease_idx" ON "memory_p2_job_projection" ("recovery_lease_expires_at", "ai_job_id");

DROP INDEX IF EXISTS "ai_job_non_maintainer_trigger_dedupe_key";
CREATE UNIQUE INDEX "ai_job_non_maintainer_trigger_dedupe_key"
  ON "ai_job" ("trigger_dedupe_key")
  WHERE "trigger_dedupe_key" IS NOT NULL
    AND "job_type" <> 'working_memory_maintain'
    AND "trigger_dedupe_key" NOT LIKE 'memory-p2-v1:%';
CREATE UNIQUE INDEX "ai_job_p2_live_trigger_dedupe_key"
  ON "ai_job" ("trigger_dedupe_key")
  WHERE "trigger_dedupe_key" LIKE 'memory-p2-v1:%'
    AND "status" IN ('pending', 'running', 'succeeded');
CREATE UNIQUE INDEX "ai_job_p2_trigger_attempt_key"
  ON "ai_job" ("trigger_dedupe_key", "attempt_no")
  WHERE "trigger_dedupe_key" LIKE 'memory-p2-v1:%';

CREATE FUNCTION "verify_memory_p2_job_namespace"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."job_type"::text IN ('mid_online', 'mid_final', 'long_session_end')
     AND (NEW."trigger_dedupe_key" IS NULL OR NEW."trigger_dedupe_key" NOT LIKE 'memory-p2-v1:%') THEN
    RAISE EXCEPTION 'P2_JOB_NAMESPACE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF NEW."trigger_dedupe_key" LIKE 'memory-p2-v1:%'
     AND NEW."job_type"::text NOT IN ('mid_online', 'mid_final', 'long_session_end') THEN
    RAISE EXCEPTION 'P2_JOB_NAMESPACE_RESERVED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ai_job_p2_namespace_guard"
  BEFORE INSERT OR UPDATE OF "job_type", "trigger_dedupe_key" ON "ai_job"
  FOR EACH ROW EXECUTE FUNCTION "verify_memory_p2_job_namespace"();

CREATE TABLE "decision_trace_memory_semantic" (
  "trace_id" UUID NOT NULL,
  "ai_job_id" UUID NOT NULL,
  "deletion_scope_digest" CHAR(64) NOT NULL,
  "source_manifest_hash" CHAR(64) NOT NULL,
  "proposal_digest" CHAR(64),
  "plan_digest" CHAR(64),
  "commit_digest" CHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decision_trace_memory_semantic_pkey" PRIMARY KEY ("trace_id"),
  CONSTRAINT "decision_trace_memory_semantic_job_key" UNIQUE ("ai_job_id"),
  CONSTRAINT "decision_trace_memory_semantic_digest_ck" CHECK (
    "deletion_scope_digest" ~ '^[0-9a-f]{64}$' AND "source_manifest_hash" ~ '^[0-9a-f]{64}$'
    AND ("proposal_digest" IS NULL OR "proposal_digest" ~ '^[0-9a-f]{64}$')
    AND ("plan_digest" IS NULL OR "plan_digest" ~ '^[0-9a-f]{64}$')
    AND ("commit_digest" IS NULL OR "commit_digest" ~ '^[0-9a-f]{64}$')
  )
);

CREATE TABLE "decision_trace_memory_source_reference" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "trace_id" UUID NOT NULL,
  "source_kind" VARCHAR(24) NOT NULL,
  "source_id" UUID,
  "source_revision" INTEGER NOT NULL,
  "membership_digest" CHAR(64) NOT NULL,
  "deletion_scope_digest" CHAR(64) NOT NULL,
  "input_order" INTEGER NOT NULL,
  "source_checkpoint_id" UUID,
  "source_job_id" UUID,
  "ai_job_input_segment_id" UUID,
  "evidence_id" UUID,
  "resolution_authority_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decision_trace_memory_source_reference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_trace_memory_source_reference_order_key" UNIQUE ("trace_id", "input_order"),
  CONSTRAINT "decision_trace_memory_source_kind_domain_ck" CHECK ("source_kind" IN ('checkpoint', 'job', 'input_segment', 'evidence', 'resolution')),
  CONSTRAINT "decision_trace_memory_source_kind_checkpoint_ck" CHECK ("source_kind" <> 'checkpoint' OR ("source_checkpoint_id" IS NOT NULL AND "source_job_id" IS NULL)),
  CONSTRAINT "decision_trace_memory_source_kind_job_ck" CHECK ("source_kind" <> 'job' OR ("source_job_id" IS NOT NULL AND "source_checkpoint_id" IS NULL)),
  CONSTRAINT "decision_trace_memory_source_kind_input_segment_ck" CHECK ("source_kind" <> 'input_segment' OR "ai_job_input_segment_id" IS NOT NULL),
  CONSTRAINT "decision_trace_memory_source_kind_evidence_ck" CHECK ("source_kind" <> 'evidence' OR "evidence_id" IS NOT NULL),
  CONSTRAINT "decision_trace_memory_source_kind_resolution_ck" CHECK ("source_kind" <> 'resolution' OR "resolution_authority_id" IS NOT NULL),
  CONSTRAINT "decision_trace_memory_source_exactly_one_typed_ref_ck" CHECK (num_nonnulls("source_checkpoint_id", "source_job_id", "ai_job_input_segment_id", "evidence_id", "resolution_authority_id") = 1),
  CONSTRAINT "decision_trace_memory_source_values_ck" CHECK ("source_revision" >= 0 AND "input_order" >= 0 AND "membership_digest" ~ '^[0-9a-f]{64}$' AND "deletion_scope_digest" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "decision_trace_memory_semantic_job_idx" ON "decision_trace_memory_semantic" ("ai_job_id");
CREATE INDEX "decision_trace_memory_semantic_deletion_scope_digest_idx" ON "decision_trace_memory_semantic" ("deletion_scope_digest");
CREATE INDEX "decision_trace_memory_source_kind_idx" ON "decision_trace_memory_source_reference" ("trace_id", "source_kind");

ALTER TABLE "decision_trace"
  ADD CONSTRAINT "decision_trace_kind_domain_ck" CHECK ("trace_kind" IN ('question_orchestration', 'memory_layer_evolve')),
  ADD CONSTRAINT "decision_trace_memory_parent_ck" CHECK (
    "trace_kind" <> 'memory_layer_evolve'
    OR (
      "trigger_type" = 'memory_layer_evolve'
      AND "memory_outcome" IN ('checkpoint_committed', 'long_committed', 'no_change', 'unjudged', 'failed', 'cancelled', 'unavailable')
      AND "decision_outcome" = 'unavailable'
      AND "director_invoked" = false
      AND "context_revision" = 0
      AND "stage_timings_json" = '{}'::jsonb
      AND "status" IN ('running', 'succeeded', 'failed', 'cancelled', 'unavailable')
      AND "stage" IN ('frozen', 'proposed', 'validated', 'planned', 'committed', 'recovered', 'terminal')
      AND "ai_job_id" IS NOT NULL
      AND (("status" IN ('failed', 'unavailable') AND "error_code" IS NOT NULL) OR ("status" NOT IN ('failed', 'unavailable') AND "error_code" IS NULL))
    )
  );

CREATE TABLE "memory_p2_retention_target" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ai_job_id" UUID NOT NULL,
  "target_kind" VARCHAR(24) NOT NULL,
  "target_id" UUID NOT NULL,
  "checkpoint_id" UUID,
  "layer_revision_id" UUID,
  "job_target_id" UUID,
  "trace_id" UUID,
  "cleanup_job_id" UUID,
  "input_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_p2_retention_target_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_p2_retention_target_identity_key" UNIQUE ("ai_job_id", "target_kind", "target_id"),
  CONSTRAINT "memory_p2_retention_target_order_key" UNIQUE ("ai_job_id", "input_order"),
  CONSTRAINT "memory_p2_retention_target_kind_ck" CHECK ("target_kind" IN ('checkpoint', 'layer_revision', 'job', 'trace')),
  CONSTRAINT "memory_p2_retention_target_exactly_one_ck" CHECK (num_nonnulls("checkpoint_id", "layer_revision_id", "job_target_id", "trace_id") = 1),
  CONSTRAINT "memory_p2_retention_target_kind_match_ck" CHECK (
    ("target_kind" = 'checkpoint' AND "checkpoint_id" = "target_id")
    OR ("target_kind" = 'layer_revision' AND "layer_revision_id" = "target_id")
    OR ("target_kind" = 'job' AND "job_target_id" = "target_id")
    OR ("target_kind" = 'trace' AND "trace_id" = "target_id")
  ),
  CONSTRAINT "memory_p2_retention_target_order_ck" CHECK ("input_order" >= 0)
);

CREATE TABLE "memory_p2_migration_manifest" (
  "manifest_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schema_version" VARCHAR(80) NOT NULL,
  "source_version" VARCHAR(80) NOT NULL,
  "target_version" VARCHAR(80) NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "predecessor_fingerprint" CHAR(64) NOT NULL,
  "expected_migration_count" INTEGER NOT NULL,
  "last_resolution_id" UUID,
  "error_code" VARCHAR(80),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "memory_p2_migration_manifest_pkey" PRIMARY KEY ("manifest_id"),
  CONSTRAINT "memory_p2_migration_manifest_identity_key" UNIQUE ("schema_version", "source_version", "target_version", "mode", "predecessor_fingerprint"),
  CONSTRAINT "memory_p2_migration_manifest_mode_ck" CHECK ("mode" IN ('fresh', 'upgrade')),
  CONSTRAINT "memory_p2_migration_manifest_status_ck" CHECK ("status" IN ('upgrading', 'completed', 'interrupted', 'unavailable')),
  CONSTRAINT "memory_p2_migration_manifest_count_ck" CHECK ("expected_migration_count" = 26),
  CONSTRAINT "memory_p2_migration_manifest_fingerprint_ck" CHECK ("predecessor_fingerprint" = '2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6'),
  CONSTRAINT "memory_p2_migration_manifest_terminal_ck" CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL))
);

CREATE INDEX "memory_p2_migration_manifest_status_idx" ON "memory_p2_migration_manifest" ("status");

-- Keep the pre-P2 actions on legacy ownership FKs. These constraints are used by
-- existing cleanup flows; the P2-only guard below prevents them from cascading a
-- P2 semantic row. P2 reference/provenance FKs remain RESTRICT below.
ALTER TABLE "memory_claim" DROP CONSTRAINT IF EXISTS "memory_claim_project_fkey";
ALTER TABLE "memory_claim" DROP CONSTRAINT IF EXISTS "memory_claim_job_fkey";
ALTER TABLE "memory_claim" DROP CONSTRAINT IF EXISTS "memory_claim_retention_root_fkey";
ALTER TABLE "memory_claim" DROP CONSTRAINT IF EXISTS "memory_claim_derived_fkey";
ALTER TABLE "memory_claim_evidence" DROP CONSTRAINT IF EXISTS "memory_claim_evidence_claim_fkey";
ALTER TABLE "memory_claim_evidence" DROP CONSTRAINT IF EXISTS "memory_claim_evidence_input_fkey";
ALTER TABLE "memory_resolution" DROP CONSTRAINT IF EXISTS "memory_resolution_project_fkey";
ALTER TABLE "memory_resolution" DROP CONSTRAINT IF EXISTS "memory_resolution_job_fkey";
ALTER TABLE "memory_resolution" DROP CONSTRAINT IF EXISTS "memory_resolution_retention_root_fkey";
ALTER TABLE "memory_resolution" DROP CONSTRAINT IF EXISTS "memory_resolution_derived_fkey";
ALTER TABLE "memory_resolution" DROP CONSTRAINT IF EXISTS "memory_resolution_supersedes_fkey";
ALTER TABLE "memory_resolution_member" DROP CONSTRAINT IF EXISTS "memory_resolution_member_resolution_fkey";
ALTER TABLE "memory_resolution_member" DROP CONSTRAINT IF EXISTS "memory_resolution_member_claim_fkey";

ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_retention_root_fkey" FOREIGN KEY ("memory_retention_root_id") REFERENCES "memory_retention_root"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_derived_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_claim_evidence" ADD CONSTRAINT "memory_claim_evidence_claim_fkey" FOREIGN KEY ("memory_claim_id") REFERENCES "memory_claim"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim_evidence" ADD CONSTRAINT "memory_claim_evidence_input_fkey" FOREIGN KEY ("ai_job_input_segment_id") REFERENCES "ai_job_input_segment"("id") ON DELETE CASCADE;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_retention_root_fkey" FOREIGN KEY ("memory_retention_root_id") REFERENCES "memory_retention_root"("id") ON DELETE CASCADE;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_derived_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION "prevent_p2_semantic_cascade"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p2_claim BOOLEAN := false;
  p2_resolution BOOLEAN := false;
  p2_evidence BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME = 'ai_job' THEN
    p2_claim := OLD."job_type"::text IN ('mid_online', 'mid_final', 'long_session_end')
      AND EXISTS (SELECT 1 FROM "memory_claim" WHERE "ai_job_id" = OLD."id");
    p2_resolution := EXISTS (
      SELECT 1 FROM "memory_resolution"
       WHERE "ai_job_id" = OLD."id" AND ("p2_write" OR "authority_id" IS NOT NULL)
    );
  ELSIF TG_TABLE_NAME = 'elder_project' THEN
    p2_claim := EXISTS (
      SELECT 1 FROM "memory_claim" c
      JOIN "ai_job" j ON j."id" = c."ai_job_id"
       WHERE c."project_id" = OLD."id"
         AND j."job_type"::text IN ('mid_online', 'mid_final', 'long_session_end')
    );
    p2_resolution := EXISTS (
      SELECT 1 FROM "memory_resolution"
       WHERE "project_id" = OLD."id" AND ("p2_write" OR "authority_id" IS NOT NULL)
    );
  ELSIF TG_TABLE_NAME = 'memory_retention_root' THEN
    p2_claim := EXISTS (
      SELECT 1 FROM "memory_claim" c
      JOIN "ai_job" j ON j."id" = c."ai_job_id"
       WHERE c."memory_retention_root_id" = OLD."id"
         AND j."job_type"::text IN ('mid_online', 'mid_final', 'long_session_end')
    );
    p2_resolution := EXISTS (
      SELECT 1 FROM "memory_resolution"
       WHERE "memory_retention_root_id" = OLD."id" AND ("p2_write" OR "authority_id" IS NOT NULL)
    );
  ELSIF TG_TABLE_NAME = 'ai_derived_output' THEN
    p2_claim := EXISTS (
      SELECT 1 FROM "memory_claim" c
      JOIN "ai_job" j ON j."id" = c."ai_job_id"
       WHERE c."ai_derived_output_id" = OLD."id"
         AND j."job_type"::text IN ('mid_online', 'mid_final', 'long_session_end')
    );
    p2_resolution := EXISTS (
      SELECT 1 FROM "memory_resolution"
       WHERE "ai_derived_output_id" = OLD."id" AND ("p2_write" OR "authority_id" IS NOT NULL)
    );
  ELSIF TG_TABLE_NAME = 'ai_job_input_segment' THEN
    p2_evidence := EXISTS (
      SELECT 1 FROM "memory_claim_evidence"
       WHERE "ai_job_input_segment_id" = OLD."id" AND "evidence_id" IS NOT NULL
    ) OR EXISTS (
      SELECT 1 FROM "memory_evidence_bridge" WHERE "ai_job_input_segment_id" = OLD."id"
    );
  ELSIF TG_TABLE_NAME = 'memory_claim' THEN
    p2_evidence := EXISTS (
      SELECT 1 FROM "memory_claim_evidence"
       WHERE "memory_claim_id" = OLD."id" AND "evidence_id" IS NOT NULL
    ) OR EXISTS (
      SELECT 1 FROM "memory_evidence_bridge" WHERE "claim_id" = OLD."id"
    );
  END IF;

  IF p2_claim OR p2_resolution OR p2_evidence THEN
    RAISE EXCEPTION 'P2_SEMANTIC_CASCADE_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "ai_job_p2_semantic_cascade_guard"
  BEFORE DELETE ON "ai_job" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_semantic_cascade"();
CREATE TRIGGER "elder_project_p2_semantic_cascade_guard"
  BEFORE DELETE ON "elder_project" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_semantic_cascade"();
CREATE TRIGGER "memory_retention_root_p2_semantic_cascade_guard"
  BEFORE DELETE ON "memory_retention_root" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_semantic_cascade"();
CREATE TRIGGER "ai_derived_output_p2_semantic_cascade_guard"
  BEFORE DELETE ON "ai_derived_output" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_semantic_cascade"();
CREATE TRIGGER "ai_job_input_segment_p2_evidence_guard"
  BEFORE DELETE ON "ai_job_input_segment" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_semantic_cascade"();
CREATE TRIGGER "memory_claim_p2_evidence_guard"
  BEFORE DELETE ON "memory_claim" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_semantic_cascade"();

CREATE UNIQUE INDEX "memory_resolution_authority_id_resolution_revision_key"
  ON "memory_resolution" ("authority_id", "resolution_revision");

ALTER TABLE "memory_resolution_authority" ADD CONSTRAINT "memory_resolution_authority_project_fk" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_resolution_authority" ADD CONSTRAINT "memory_resolution_authority_session_fk" FOREIGN KEY ("origin_session_id") REFERENCES "interview_session"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_resolution_authority" ADD CONSTRAINT "memory_resolution_authority_thread_fk" FOREIGN KEY ("origin_thread_id") REFERENCES "memory_thread"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_authority_revision_fk" FOREIGN KEY ("authority_id") REFERENCES "memory_resolution_authority"("authority_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_supersedes_fk" FOREIGN KEY ("supersedes_resolution_id") REFERENCES "memory_resolution"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_resolution_member" ADD CONSTRAINT "memory_resolution_member_resolution_fk" FOREIGN KEY ("memory_resolution_id") REFERENCES "memory_resolution"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_resolution_member" ADD CONSTRAINT "memory_resolution_member_claim_fk" FOREIGN KEY ("memory_claim_id") REFERENCES "memory_claim"("id") ON DELETE RESTRICT;

ALTER TABLE "memory_evidence_authority" ADD CONSTRAINT "memory_evidence_authority_project_fk" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_evidence_authority" ADD CONSTRAINT "memory_evidence_authority_session_fk" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_evidence_authority" ADD CONSTRAINT "memory_evidence_authority_transcript_fk" FOREIGN KEY ("source_id") REFERENCES "transcript_segment"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_evidence_bridge" ADD CONSTRAINT "memory_evidence_bridge_authority_fk" FOREIGN KEY ("evidence_id") REFERENCES "memory_evidence_authority"("evidence_id") ON DELETE RESTRICT;
ALTER TABLE "memory_evidence_bridge" ADD CONSTRAINT "memory_evidence_bridge_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "memory_claim"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_evidence_bridge" ADD CONSTRAINT "memory_evidence_bridge_input_segment_fk" FOREIGN KEY ("ai_job_input_segment_id") REFERENCES "ai_job_input_segment"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_evidence_bridge" ADD CONSTRAINT "memory_evidence_bridge_revision_owner_fk" FOREIGN KEY ("evidence_id", "authority_revision") REFERENCES "memory_evidence_authority"("evidence_id", "authority_revision") ON DELETE RESTRICT;
ALTER TABLE "memory_claim_evidence" ADD CONSTRAINT "memory_claim_evidence_authority_revision_fk" FOREIGN KEY ("evidence_id", "authority_revision") REFERENCES "memory_evidence_authority"("evidence_id", "authority_revision") ON DELETE RESTRICT;

ALTER TABLE "memory_evolution_checkpoint" ADD CONSTRAINT "memory_checkpoint_project_fk" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_evolution_checkpoint" ADD CONSTRAINT "memory_checkpoint_session_fk" FOREIGN KEY ("source_session_id") REFERENCES "interview_session"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_evolution_checkpoint" ADD CONSTRAINT "memory_checkpoint_p2_job_fk" FOREIGN KEY ("p2_producer_job_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_evolution_checkpoint" ADD CONSTRAINT "memory_checkpoint_p1_terminal_job_fk" FOREIGN KEY ("source_p1_terminal_job_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_evolution_checkpoint" ADD CONSTRAINT "memory_checkpoint_working_snapshot_fk" FOREIGN KEY ("source_working_snapshot_id") REFERENCES "memory_working_snapshot"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_evolution_checkpoint" ADD CONSTRAINT "memory_checkpoint_thread_revision_fk" FOREIGN KEY ("source_thread_revision_id") REFERENCES "memory_thread_revision"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_evolution_checkpoint_member" ADD CONSTRAINT "memory_checkpoint_member_checkpoint_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "memory_evolution_checkpoint"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_evolution_checkpoint_member" ADD CONSTRAINT "memory_checkpoint_member_resolution_fk" FOREIGN KEY ("resolution_row_id") REFERENCES "memory_resolution"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_evolution_checkpoint_member" ADD CONSTRAINT "memory_checkpoint_member_authority_fk" FOREIGN KEY ("resolution_authority_id") REFERENCES "memory_resolution_authority"("authority_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "memory_layer_identity" ADD CONSTRAINT "memory_layer_identity_project_fk" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_layer_identity" ADD CONSTRAINT "memory_layer_identity_session_fk" FOREIGN KEY ("origin_session_id") REFERENCES "interview_session"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_layer_identity" ADD CONSTRAINT "memory_layer_identity_thread_fk" FOREIGN KEY ("origin_thread_id") REFERENCES "memory_thread"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_layer_identity" ADD CONSTRAINT "memory_layer_identity_resolution_authority_fk" FOREIGN KEY ("origin_resolution_authority_id") REFERENCES "memory_resolution_authority"("authority_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_layer_revision" ADD CONSTRAINT "memory_layer_revision_identity_fk" FOREIGN KEY ("identity_id") REFERENCES "memory_layer_identity"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_layer_revision" ADD CONSTRAINT "memory_layer_revision_checkpoint_fk" FOREIGN KEY ("source_checkpoint_id") REFERENCES "memory_evolution_checkpoint"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_layer_revision" ADD CONSTRAINT "memory_layer_revision_job_fk" FOREIGN KEY ("source_job_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_layer_revision" ADD CONSTRAINT "memory_layer_revision_resolution_fk" FOREIGN KEY ("resolution_row_id") REFERENCES "memory_resolution"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_layer_revision" ADD CONSTRAINT "memory_layer_revision_authority_fk" FOREIGN KEY ("resolution_authority_id") REFERENCES "memory_resolution_authority"("authority_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_layer_revision" ADD CONSTRAINT "memory_layer_revision_predecessor_fk" FOREIGN KEY ("predecessor_revision_id") REFERENCES "memory_layer_revision"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_layer_revision_member" ADD CONSTRAINT "memory_layer_revision_member_revision_fk" FOREIGN KEY ("revision_id") REFERENCES "memory_layer_revision"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_layer_revision_member" ADD CONSTRAINT "memory_layer_revision_member_claim_fk" FOREIGN KEY ("memory_claim_id") REFERENCES "memory_claim"("id") ON DELETE RESTRICT;

ALTER TABLE "memory_long_job_projection" ADD CONSTRAINT "memory_long_projection_job_fk" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_long_job_projection" ADD CONSTRAINT "memory_long_projection_target_revision_fk" FOREIGN KEY ("target_layer_revision_id") REFERENCES "memory_layer_revision"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_long_job_projection" ADD CONSTRAINT "memory_long_projection_checkpoint_fk" FOREIGN KEY ("source_final_checkpoint_id") REFERENCES "memory_evolution_checkpoint"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_long_job_projection_source" ADD CONSTRAINT "memory_long_projection_source_projection_fk" FOREIGN KEY ("projection_id") REFERENCES "memory_long_job_projection"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_long_job_projection_source" ADD CONSTRAINT "memory_long_projection_source_session_fk" FOREIGN KEY ("source_session_id") REFERENCES "interview_session"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_long_job_projection_source" ADD CONSTRAINT "memory_long_projection_source_revision_fk" FOREIGN KEY ("source_mid_revision_id") REFERENCES "memory_layer_revision"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "memory_p2_job_projection" ADD CONSTRAINT "memory_p2_job_projection_job_fk" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_p2_job_projection" ADD CONSTRAINT "memory_p2_job_projection_checkpoint_fk" FOREIGN KEY ("source_checkpoint_id") REFERENCES "memory_evolution_checkpoint"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_job_projection" ADD CONSTRAINT "memory_p2_job_projection_final_mid_fk" FOREIGN KEY ("source_final_mid_checkpoint_id") REFERENCES "memory_evolution_checkpoint"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_job_projection" ADD CONSTRAINT "memory_p2_job_projection_p1_terminal_fk" FOREIGN KEY ("source_p1_terminal_job_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_job_projection" ADD CONSTRAINT "memory_p2_job_projection_snapshot_fk" FOREIGN KEY ("source_working_snapshot_id") REFERENCES "memory_working_snapshot"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_job_projection" ADD CONSTRAINT "memory_p2_job_projection_thread_revision_fk" FOREIGN KEY ("source_thread_revision_id") REFERENCES "memory_thread_revision"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_job_projection" ADD CONSTRAINT "memory_p2_job_projection_target_identity_fk" FOREIGN KEY ("target_layer_identity_id") REFERENCES "memory_layer_identity"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_job_projection" ADD CONSTRAINT "memory_p2_job_projection_target_revision_fk" FOREIGN KEY ("target_layer_revision_id") REFERENCES "memory_layer_revision"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "decision_trace_memory_semantic" ADD CONSTRAINT "decision_trace_memory_semantic_trace_fk" FOREIGN KEY ("trace_id") REFERENCES "decision_trace"("id") ON DELETE RESTRICT;
ALTER TABLE "decision_trace_memory_semantic" ADD CONSTRAINT "decision_trace_memory_semantic_job_fk" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "decision_trace_memory_source_reference" ADD CONSTRAINT "decision_trace_memory_source_trace_fk" FOREIGN KEY ("trace_id") REFERENCES "decision_trace"("id") ON DELETE RESTRICT;
ALTER TABLE "decision_trace_memory_source_reference" ADD CONSTRAINT "decision_trace_memory_source_checkpoint_fk" FOREIGN KEY ("source_checkpoint_id") REFERENCES "memory_evolution_checkpoint"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "decision_trace_memory_source_reference" ADD CONSTRAINT "decision_trace_memory_source_job_fk" FOREIGN KEY ("source_job_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "decision_trace_memory_source_reference" ADD CONSTRAINT "decision_trace_memory_source_input_segment_fk" FOREIGN KEY ("ai_job_input_segment_id") REFERENCES "ai_job_input_segment"("id") ON DELETE RESTRICT;
ALTER TABLE "decision_trace_memory_source_reference" ADD CONSTRAINT "decision_trace_memory_source_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "memory_evidence_authority"("evidence_id") ON DELETE RESTRICT;
ALTER TABLE "decision_trace_memory_source_reference" ADD CONSTRAINT "decision_trace_memory_source_authority_fk" FOREIGN KEY ("resolution_authority_id") REFERENCES "memory_resolution_authority"("authority_id") ON DELETE RESTRICT;

ALTER TABLE "memory_p2_retention_target" ADD CONSTRAINT "memory_p2_retention_target_job_fk" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_p2_retention_target" ADD CONSTRAINT "memory_p2_retention_target_checkpoint_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "memory_evolution_checkpoint"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_retention_target" ADD CONSTRAINT "memory_p2_retention_target_revision_fk" FOREIGN KEY ("layer_revision_id") REFERENCES "memory_layer_revision"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_retention_target" ADD CONSTRAINT "memory_p2_retention_target_job_target_fk" FOREIGN KEY ("job_target_id") REFERENCES "ai_job"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_retention_target" ADD CONSTRAINT "memory_p2_retention_target_trace_fk" FOREIGN KEY ("trace_id") REFERENCES "decision_trace"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_p2_retention_target" ADD CONSTRAINT "memory_p2_retention_target_cleanup_job_fk" FOREIGN KEY ("cleanup_job_id") REFERENCES "ai_job"("id") ON DELETE SET NULL;

CREATE INDEX "memory_resolution_authority_origin_idx" ON "memory_resolution_authority" ("origin_session_id", "origin_thread_id");
CREATE INDEX "memory_evidence_authority_source_idx" ON "memory_evidence_authority" ("source_id");
CREATE INDEX "memory_evidence_bridge_authority_idx" ON "memory_evidence_bridge" ("evidence_id", "authority_revision");
CREATE INDEX "memory_checkpoint_scope_idx" ON "memory_evolution_checkpoint" ("project_id", "source_session_id", "created_at" DESC);
CREATE INDEX "memory_checkpoint_status_idx" ON "memory_evolution_checkpoint" ("lifecycle_status");
CREATE INDEX "memory_checkpoint_member_resolution_idx" ON "memory_evolution_checkpoint_member" ("resolution_row_id");
CREATE INDEX "memory_layer_revision_scope_idx" ON "memory_layer_revision" ("project_id", "source_session_id", "layer", "lifecycle_status");
CREATE INDEX "memory_layer_revision_authority_idx" ON "memory_layer_revision" ("resolution_authority_id", "resolution_revision");

-- The physical manifest freezes 62 P2 FKs. The two composite evidence-owner FKs above
-- are parity guards; all 62 manifest-listed constraints retain their literal names.

CREATE FUNCTION "verify_memory_resolution_p2_authority"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  authority_row "memory_resolution_authority"%ROWTYPE;
  predecessor "memory_resolution"%ROWTYPE;
BEGIN
  IF NEW."authority_id" IS NULL THEN
    IF NEW."p2_write" THEN RAISE EXCEPTION 'P2_AUTHORITY_REQUIRED' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO authority_row FROM "memory_resolution_authority"
    WHERE "authority_id" = NEW."authority_id" FOR KEY SHARE;
  IF NOT FOUND OR authority_row."project_id" <> NEW."project_id"
     OR authority_row."semantic_kind" <> NEW."semantic_kind"
     OR authority_row."canonical_key" <> NEW."canonical_key" THEN
    RAISE EXCEPTION 'P2_AUTHORITY_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW."p2_write" AND NEW."resolution_revision" = 1 AND NEW."supersedes_resolution_id" IS NOT NULL THEN
    RAISE EXCEPTION 'P2_NEW_SLOT_SUPERSEDES_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  IF NEW."p2_write" AND NEW."resolution_revision" > 1 THEN
    IF NEW."supersedes_resolution_id" IS NULL THEN
      RAISE EXCEPTION 'P2_PREDECESSOR_REQUIRED' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO predecessor FROM "memory_resolution"
      WHERE "id" = NEW."supersedes_resolution_id" FOR KEY SHARE;
    IF NOT FOUND OR predecessor."authority_id" <> NEW."authority_id"
       OR predecessor."resolution_revision" + 1 <> NEW."resolution_revision"
       OR predecessor."status" <> 'superseded' THEN
      RAISE EXCEPTION 'P2_PREDECESSOR_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "memory_resolution_p2_authority_guard"
  BEFORE INSERT OR UPDATE OF "authority_id", "resolution_revision", "supersedes_resolution_id", "p2_write", "project_id", "semantic_kind", "canonical_key"
  ON "memory_resolution" FOR EACH ROW EXECUTE FUNCTION "verify_memory_resolution_p2_authority"();

CREATE FUNCTION "verify_memory_checkpoint_complete"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actual_count INTEGER;
  p2_job "ai_job"%ROWTYPE;
  p1_job "ai_job"%ROWTYPE;
  snapshot "memory_working_snapshot"%ROWTYPE;
  thread_revision "memory_thread_revision"%ROWTYPE;
BEGIN
  SELECT * INTO p2_job FROM "ai_job" WHERE "id" = NEW."p2_producer_job_id";
  SELECT * INTO snapshot FROM "memory_working_snapshot" WHERE "id" = NEW."source_working_snapshot_id";
  SELECT * INTO thread_revision FROM "memory_thread_revision" WHERE "id" = NEW."source_thread_revision_id";
  IF p2_job."project_id" <> NEW."project_id" OR p2_job."job_type"::text <> (CASE WHEN NEW."trigger_kind" = 'session_final_flush' THEN 'mid_final' ELSE 'mid_online' END)
     OR snapshot."project_id" <> NEW."project_id" OR snapshot."source_session_id" <> NEW."source_session_id"
     OR snapshot."contract_version" <> NEW."source_working_snapshot_contract_version"
     OR thread_revision."thread_id" <> NEW."source_thread_id" OR thread_revision."revision" <> NEW."source_thread_revision"
     OR thread_revision."status"::text <> NEW."source_thread_status" THEN
    RAISE EXCEPTION 'P2_CHECKPOINT_SOURCE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW."source_p1_terminal_job_id" IS NOT NULL THEN
    SELECT * INTO p1_job FROM "ai_job" WHERE "id" = NEW."source_p1_terminal_job_id";
    IF p1_job."project_id" <> NEW."project_id" OR p1_job."job_type" <> 'working_memory_maintain'
       OR p1_job."status" <> 'succeeded' OR p1_job."trigger_dedupe_key" NOT LIKE 'memory-p1-v1.2:%' THEN
      RAISE EXCEPTION 'P2_CHECKPOINT_P1_TERMINAL_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT count(*) INTO actual_count FROM "memory_evolution_checkpoint_member" WHERE "checkpoint_id" = NEW."id";
  IF actual_count <> NEW."expected_member_count" THEN
    RAISE EXCEPTION 'P2_CHECKPOINT_MEMBER_COUNT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "memory_checkpoint_complete_guard"
  AFTER INSERT OR UPDATE ON "memory_evolution_checkpoint"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "verify_memory_checkpoint_complete"();

CREATE FUNCTION "verify_memory_checkpoint_member_authority"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source_row "memory_resolution"%ROWTYPE;
BEGIN
  SELECT * INTO source_row FROM "memory_resolution" WHERE "id" = NEW."resolution_row_id";
  IF source_row."authority_id" IS NULL OR source_row."authority_id" <> NEW."resolution_authority_id"
     OR source_row."resolution_revision" <> NEW."resolution_revision"
     OR source_row."semantic_status" <> NEW."semantic_status" THEN
    RAISE EXCEPTION 'P2_CHECKPOINT_MEMBER_AUTHORITY_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "memory_checkpoint_member_authority_guard"
  AFTER INSERT OR UPDATE ON "memory_evolution_checkpoint_member"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "verify_memory_checkpoint_member_authority"();

CREATE FUNCTION "verify_memory_layer_revision"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE identity_row "memory_layer_identity"%ROWTYPE;
DECLARE resolution_row "memory_resolution"%ROWTYPE;
DECLARE predecessor "memory_layer_revision"%ROWTYPE;
BEGIN
  SELECT * INTO identity_row FROM "memory_layer_identity" WHERE "id" = NEW."identity_id";
  SELECT * INTO resolution_row FROM "memory_resolution" WHERE "id" = NEW."resolution_row_id";
  IF identity_row."project_id" <> NEW."project_id" OR resolution_row."authority_id" <> NEW."resolution_authority_id"
     OR resolution_row."resolution_revision" <> NEW."resolution_revision" OR resolution_row."semantic_status" <> NEW."semantic_status" THEN
    RAISE EXCEPTION 'P2_LAYER_AUTHORITY_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision_no" > 1 THEN
    SELECT * INTO predecessor FROM "memory_layer_revision" WHERE "id" = NEW."predecessor_revision_id";
    IF predecessor."identity_id" <> NEW."identity_id" OR predecessor."revision_no" + 1 <> NEW."revision_no" THEN
      RAISE EXCEPTION 'P2_LAYER_PREDECESSOR_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "memory_layer_revision_authority_guard"
  AFTER INSERT OR UPDATE ON "memory_layer_revision"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "verify_memory_layer_revision"();

CREATE FUNCTION "verify_memory_layer_member_count"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE actual_count INTEGER;
BEGIN
  SELECT count(*) INTO actual_count FROM "memory_layer_revision_member" WHERE "revision_id" = NEW."id";
  IF actual_count <> NEW."expected_member_count" THEN
    RAISE EXCEPTION 'P2_LAYER_MEMBER_COUNT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "memory_layer_member_count_guard"
  AFTER INSERT OR UPDATE ON "memory_layer_revision"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "verify_memory_layer_member_count"();

CREATE FUNCTION "verify_memory_p2_job_projection"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE job_row "ai_job"%ROWTYPE;
DECLARE retry_row "ai_job"%ROWTYPE;
BEGIN
  SELECT * INTO job_row FROM "ai_job" WHERE "id" = NEW."ai_job_id" FOR KEY SHARE;
  IF job_row."job_type"::text <> NEW."job_kind"
     OR job_row."trigger_dedupe_key" NOT LIKE 'memory-p2-v1:%'
     OR job_row."trigger_dedupe_key" IS NULL THEN
    RAISE EXCEPTION 'P2_JOB_IDENTITY_INVALID' USING ERRCODE = '23514';
  END IF;
  IF NEW."recovery_lease_expires_at" > job_row."expires_at" THEN
    RAISE EXCEPTION 'P2_RECOVERY_LEASE_OUTLIVES_JOB' USING ERRCODE = '23514';
  END IF;
  IF job_row."status" <> 'succeeded' AND (NEW."target_layer_identity_id" IS NOT NULL OR NEW."target_layer_revision_id" IS NOT NULL OR NEW."target_revision_digest" IS NOT NULL) THEN
    RAISE EXCEPTION 'P2_NON_SUCCESS_TARGET_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  IF job_row."status" = 'succeeded' AND (NEW."target_layer_identity_id" IS NULL OR NEW."target_layer_revision_id" IS NULL OR NEW."target_revision_digest" IS NULL) THEN
    RAISE EXCEPTION 'P2_SUCCESS_TARGET_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF job_row."status" IN ('failed', 'cancelled', 'unavailable') AND job_row."retry_of_job_id" IS NOT NULL THEN
    SELECT * INTO retry_row FROM "ai_job" WHERE "id" = job_row."retry_of_job_id";
    IF retry_row."job_type" <> job_row."job_type" OR retry_row."trigger_dedupe_key" <> job_row."trigger_dedupe_key"
       OR retry_row."attempt_no" + 1 <> job_row."attempt_no" OR retry_row."status" NOT IN ('failed', 'cancelled', 'unavailable') THEN
      RAISE EXCEPTION 'P2_RETRY_PREDECESSOR_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "memory_p2_job_projection_guard"
  AFTER INSERT OR UPDATE ON "memory_p2_job_projection"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "verify_memory_p2_job_projection"();

CREATE FUNCTION "verify_memory_long_projection"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE actual_count INTEGER;
DECLARE target "memory_layer_revision"%ROWTYPE;
DECLARE job_row "ai_job"%ROWTYPE;
BEGIN
  SELECT count(*) INTO actual_count FROM "memory_long_job_projection_source" WHERE "projection_id" = NEW."id";
  SELECT * INTO target FROM "memory_layer_revision" WHERE "id" = NEW."target_layer_revision_id";
  SELECT * INTO job_row FROM "ai_job" WHERE "id" = NEW."ai_job_id";
  IF actual_count <> NEW."expected_source_count" OR target."layer" <> 'long' OR target."source_job_id" <> NEW."ai_job_id"
     OR job_row."job_type" <> 'long_session_end' OR job_row."status" <> 'succeeded' THEN
    RAISE EXCEPTION 'P2_LONG_PROJECTION_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "memory_long_projection_guard"
  AFTER INSERT OR UPDATE ON "memory_long_job_projection"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "verify_memory_long_projection"();

CREATE FUNCTION "verify_memory_trace_semantic"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent "decision_trace"%ROWTYPE;
DECLARE projection "memory_p2_job_projection"%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM "decision_trace" WHERE "id" = NEW."trace_id";
  SELECT * INTO projection FROM "memory_p2_job_projection" WHERE "ai_job_id" = NEW."ai_job_id";
  IF parent."trace_kind" <> 'memory_layer_evolve' OR parent."ai_job_id" <> NEW."ai_job_id"
     OR projection."deletion_scope_digest" <> NEW."deletion_scope_digest" THEN
    RAISE EXCEPTION 'P2_TRACE_PARENT_INVALID' USING ERRCODE = '23514';
  END IF;
  IF parent."status" = 'succeeded' AND (NEW."proposal_digest" IS NULL OR NEW."plan_digest" IS NULL OR NEW."commit_digest" IS NULL) THEN
    RAISE EXCEPTION 'P2_TRACE_COMMIT_DIGEST_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF parent."status" <> 'succeeded' AND NEW."commit_digest" IS NOT NULL THEN
    RAISE EXCEPTION 'P2_TRACE_NON_SUCCESS_COMMIT_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "decision_trace_memory_semantic_guard"
  AFTER INSERT OR UPDATE ON "decision_trace_memory_semantic"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "verify_memory_trace_semantic"();

CREATE FUNCTION "verify_memory_trace_source_scope"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE semantic_row "decision_trace_memory_semantic"%ROWTYPE;
BEGIN
  SELECT * INTO semantic_row FROM "decision_trace_memory_semantic" WHERE "trace_id" = NEW."trace_id";
  IF semantic_row."deletion_scope_digest" <> NEW."deletion_scope_digest" THEN
    RAISE EXCEPTION 'P2_TRACE_SOURCE_SCOPE_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "decision_trace_memory_source_scope_guard"
  AFTER INSERT OR UPDATE ON "decision_trace_memory_source_reference"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "verify_memory_trace_source_scope"();

CREATE FUNCTION "prevent_p2_reference_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('elder.p2_cleanup', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'P2_REFERENCE_ROWS_ARE_APPEND_ONLY' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "memory_resolution_authority_immutable" BEFORE UPDATE OR DELETE ON "memory_resolution_authority" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_reference_mutation"();
CREATE TRIGGER "memory_evidence_authority_immutable" BEFORE UPDATE OR DELETE ON "memory_evidence_authority" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_reference_mutation"();
CREATE TRIGGER "memory_evidence_bridge_immutable" BEFORE UPDATE OR DELETE ON "memory_evidence_bridge" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_reference_mutation"();
CREATE TRIGGER "memory_checkpoint_member_immutable" BEFORE UPDATE OR DELETE ON "memory_evolution_checkpoint_member" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_reference_mutation"();
CREATE TRIGGER "memory_layer_identity_immutable" BEFORE UPDATE OR DELETE ON "memory_layer_identity" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_reference_mutation"();
CREATE TRIGGER "memory_layer_revision_member_immutable" BEFORE UPDATE OR DELETE ON "memory_layer_revision_member" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_reference_mutation"();
CREATE TRIGGER "memory_long_projection_immutable" BEFORE UPDATE OR DELETE ON "memory_long_job_projection" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_reference_mutation"();
CREATE TRIGGER "memory_long_projection_source_immutable" BEFORE UPDATE OR DELETE ON "memory_long_job_projection_source" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_reference_mutation"();
CREATE TRIGGER "decision_trace_memory_source_immutable" BEFORE UPDATE OR DELETE ON "decision_trace_memory_source_reference" FOR EACH ROW EXECUTE FUNCTION "prevent_p2_reference_mutation"();

CREATE FUNCTION "guard_memory_checkpoint_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('elder.p2_cleanup', true) = 'on' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD."lifecycle_status" = 'frozen' AND NEW."lifecycle_status" = 'committed'
     AND OLD."committed_at" IS NULL AND NEW."committed_at" IS NOT NULL
     AND (to_jsonb(OLD) - 'lifecycle_status' - 'committed_at') = (to_jsonb(NEW) - 'lifecycle_status' - 'committed_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'P2_CHECKPOINT_IS_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "memory_checkpoint_immutable" BEFORE UPDATE OR DELETE ON "memory_evolution_checkpoint" FOR EACH ROW EXECUTE FUNCTION "guard_memory_checkpoint_mutation"();

CREATE FUNCTION "guard_memory_layer_revision_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('elder.p2_cleanup', true) = 'on' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD."lifecycle_status" = 'current' AND NEW."lifecycle_status" = 'superseded'
     AND (to_jsonb(OLD) - 'lifecycle_status') = (to_jsonb(NEW) - 'lifecycle_status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'P2_LAYER_REVISION_IS_APPEND_ONLY' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "memory_layer_revision_immutable" BEFORE UPDATE OR DELETE ON "memory_layer_revision" FOR EACH ROW EXECUTE FUNCTION "guard_memory_layer_revision_mutation"();

CREATE FUNCTION "verify_memory_evidence_pair_parity"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE link "memory_claim_evidence"%ROWTYPE;
DECLARE authority_row "memory_evidence_authority"%ROWTYPE;
DECLARE input_row "ai_job_input_segment"%ROWTYPE;
BEGIN
  SELECT * INTO authority_row FROM "memory_evidence_authority" WHERE "evidence_id" = NEW."evidence_id";
  SELECT * INTO input_row FROM "ai_job_input_segment" WHERE "id" = NEW."ai_job_input_segment_id";
  SELECT * INTO link FROM "memory_claim_evidence"
    WHERE "memory_claim_id" = NEW."claim_id" AND "ai_job_input_segment_id" = NEW."ai_job_input_segment_id";
  IF NOT FOUND OR link."evidence_id" <> NEW."evidence_id" OR link."authority_revision" <> NEW."authority_revision"
     OR authority_row."authority_revision" <> NEW."authority_revision"
     OR authority_row."source_id" <> input_row."transcript_segment_id"
     OR authority_row."session_id" <> input_row."session_id"
     OR authority_row."transcript_text_revision" <> input_row."text_revision"
     OR authority_row."speaker_role_revision" <> input_row."speaker_role_revision"
     OR authority_row."effective_text_digest" <> input_row."effective_text_digest"
     OR input_row."trusted_effective_role" <> 'elder' OR input_row."content_kind" <> 'conversation' THEN
    RAISE EXCEPTION 'P2_EVIDENCE_PAIR_PARITY_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "memory_evidence_pair_parity_guard"
  AFTER INSERT ON "memory_evidence_bridge"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "verify_memory_evidence_pair_parity"();

CREATE FUNCTION "memory_p2_resume_migration"() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  manifest_row "memory_p2_migration_manifest"%ROWTYPE;
  cursor_value UUID;
  batch_cursor UUID;
  has_more BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(('x' || substr(encode(digest('memory-p2-migration:2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6', 'sha256'), 'hex'), 1, 16))::bit(64)::bigint);
  SELECT * INTO manifest_row FROM "memory_p2_migration_manifest"
    WHERE "schema_version" = 'memory-persistence-p2c-v1'
      AND "source_version" = 'memory-maintainer-v1.2'
      AND "target_version" = 'memory-persistence-p2c-v1'
      AND "predecessor_fingerprint" = '2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6'
    ORDER BY "started_at" DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P2_MIGRATION_MANIFEST_MISSING' USING ERRCODE = '23514'; END IF;
  IF manifest_row."expected_migration_count" <> 26 THEN
    UPDATE "memory_p2_migration_manifest" SET "status" = 'unavailable', "error_code" = 'P2_MIGRATION_UNAVAILABLE'
      WHERE "manifest_id" = manifest_row."manifest_id";
    RETURN;
  END IF;
  IF manifest_row."status" = 'completed' THEN RETURN; END IF;
  IF manifest_row."status" = 'unavailable' THEN RETURN; END IF;

  cursor_value := manifest_row."last_resolution_id";
  SELECT "id" INTO batch_cursor FROM (
    SELECT "id" FROM "memory_resolution"
    WHERE "id" > COALESCE(cursor_value, '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY "id" ASC LIMIT 500
  ) batch ORDER BY "id" DESC LIMIT 1;
  IF batch_cursor IS NULL THEN
    UPDATE "memory_p2_migration_manifest"
       SET "status" = 'completed', "completed_at" = CURRENT_TIMESTAMP, "error_code" = NULL
     WHERE "manifest_id" = manifest_row."manifest_id";
    RETURN;
  END IF;

  WITH all_legacy_rows AS (
    SELECT r.* FROM "memory_resolution" r
    WHERE r."semantic_kind" IS NOT NULL
      AND r."source_session_id" IS NOT NULL
      AND r."thread_id" IS NOT NULL
  ), valid_slots AS (
    SELECT r."project_id", r."semantic_kind", r."canonical_key",
           min(r."source_session_id"::text)::uuid AS origin_session_id,
           min(r."thread_id"::text)::uuid AS origin_thread_id
    FROM all_legacy_rows r
    GROUP BY r."project_id", r."semantic_kind", r."canonical_key"
    HAVING min(r."resolution_revision") = 1
       AND max(r."resolution_revision") = count(*)
       AND count(DISTINCT r."resolution_revision") = count(*)
       AND count(DISTINCT r."source_session_id") = 1
       AND count(DISTINCT r."thread_id") = 1
       AND count(*) FILTER (WHERE r."status" = 'current') = 1
       AND NOT EXISTS (
         SELECT 1 FROM all_legacy_rows child
         LEFT JOIN all_legacy_rows parent ON parent."id" = child."supersedes_resolution_id"
         WHERE child."project_id" = r."project_id" AND child."semantic_kind" = r."semantic_kind" AND child."canonical_key" = r."canonical_key"
           AND ((child."resolution_revision" = 1 AND child."supersedes_resolution_id" IS NOT NULL)
             OR (child."resolution_revision" > 1 AND (parent."id" IS NULL OR parent."resolution_revision" + 1 <> child."resolution_revision")))
       )
  ), inserted AS (
    INSERT INTO "memory_resolution_authority"
      ("authority_id", "project_id", "semantic_kind", "canonical_key", "origin_session_id", "origin_thread_id")
    SELECT gen_random_uuid(), v."project_id", v."semantic_kind", v."canonical_key", v.origin_session_id, v.origin_thread_id
    FROM valid_slots v
    ON CONFLICT ("project_id", "semantic_kind", "canonical_key") DO NOTHING
    RETURNING "authority_id", "project_id", "semantic_kind", "canonical_key"
  ), authority_map AS (
    SELECT i."authority_id", i."project_id", i."semantic_kind", i."canonical_key" FROM inserted i
    UNION ALL
    SELECT a."authority_id", a."project_id", a."semantic_kind", a."canonical_key"
    FROM "memory_resolution_authority" a
    JOIN valid_slots v ON a."project_id" = v."project_id"
      AND a."semantic_kind" = v."semantic_kind" AND a."canonical_key" = v."canonical_key"
    WHERE NOT EXISTS (
      SELECT 1 FROM inserted i
      WHERE i."project_id" = a."project_id" AND i."semantic_kind" = a."semantic_kind"
        AND i."canonical_key" = a."canonical_key"
    )
  )
  UPDATE "memory_resolution" r SET "authority_id" = a."authority_id"
  FROM authority_map a, valid_slots v
  WHERE a."project_id" = v."project_id" AND a."semantic_kind" = v."semantic_kind" AND a."canonical_key" = v."canonical_key"
    AND r."project_id" = v."project_id" AND r."semantic_kind" = v."semantic_kind" AND r."canonical_key" = v."canonical_key"
    AND r."authority_id" IS NULL
    AND r."id" > COALESCE(cursor_value, '00000000-0000-0000-0000-000000000000'::uuid)
    AND r."id" <= batch_cursor;

  SELECT EXISTS (SELECT 1 FROM "memory_resolution" WHERE "id" > batch_cursor) INTO has_more;
  UPDATE "memory_p2_migration_manifest"
     SET "last_resolution_id" = batch_cursor,
         "status" = CASE WHEN has_more THEN 'upgrading' ELSE 'completed' END,
         "completed_at" = CASE WHEN has_more THEN NULL ELSE CURRENT_TIMESTAMP END,
         "error_code" = NULL
   WHERE "manifest_id" = manifest_row."manifest_id";
END $$;

DO $$
DECLARE
  migration_mode VARCHAR(16);
  mismatch_count INTEGER;
BEGIN
  WITH expected("migration_name", "checksum") AS (VALUES
    ('20260802000000_engineering_baseline', '24a9fe2b013e6da966dd9b6ce9c321ff722d79b70bb169e0a933bea419caabfa'),
    ('20260802112719_identity_security', 'ec51be16aed74332dfa6e33cf01be17ccc99b73e61d6fce25f50970ecbd34cc4'),
    ('20260803153000_project_consent_session', 'd24ee7e218ab46881e3564f7bf2e8473693748d62db2bb012f297d1960203abb'),
    ('20260804120000_audio_objects', '3c3c6a41a44cb32ff4ee57dcdb9df9a6165dd447f36005d2fee6f8cad82264e6'),
    ('20260804180000_transcript_evidence_core', '4443b9532d597458ef88a3198be6a68b4941a2cd5e759a0c61f94c2b153b84a8'),
    ('20260807190000_session_finalization', 'aa2b950057492f8fe4f8bf4f548ed363e0bf506780cc4bbf6f86b03519f6c7cf'),
    ('20260807233000_capture_lifecycle', 'b837cc1ee2c53c59865ba0048ea78a9bb598eeae83957e0ef4d9b6ccf931888a'),
    ('20260809190000_speaker_calibration_core', 'e78a3a132bf66f41cea91c63d170f9f692e93ecff0043a52973d465948803211'),
    ('20260809230000_speaker_correction_core', '33f0c6b0823d3eaac719117e1fdb9523e8482e9ddb4c244d22d003c626f4710d'),
    ('20260810043209_ai_memory_question_evidence_core', 'ff964999a91a48a43df05c6b8a906d431ffe825c3766b06ab9b050fd420a557e'),
    ('20260810062000_dev006_review_invariants', '3a927be1d328404685645f2898a3ce372ed6b76c4eed974097796981de5ac1a0'),
    ('20260810193000_dev007a_question_bank', '3cf8e03f3b51d3dbc82ba4db1991e54024c69366af38cee011b3c3abba777f0a'),
    ('20260810223000_dev007b_question_presentation', '2a3dd379143fb46ffdc114e63bd5ac8b9127eaf4e33bfafc20f8de5129d34849'),
    ('20260812143000_dev008a2_create_idempotency', 'f4d3160389225cf6be07ae892d9613522a31fc9c628ae346bcbf3a1dec5b5a8e'),
    ('20260814120000_public_auth_security', 'ddfbf4c232ca6d7b38b6ef712d9438d61fa2d2fe58d47d757df0e67ce62448c9'),
    ('20260814121000_public_auth_audit_shape', '9b0ab56f345722af8ff90ff8c380483a69378147bab0728dd12079d23293d038'),
    ('20260814210000_dev008b2_review_invariants', '92a8faae0197f0390c3547664872a4a0ad167f9a139daea6c44c1393e31d049e'),
    ('20260815120000_drop_legacy_speaker_mapping_session_unique', '997adc07c9c2872a10b90ec485c3ad30da750250376f1ac6f4a04c56a3d421b1'),
    ('20260816100000_decision_trace_v1', '1bdd42b4a8d508274cd0a20900bc134bb654f8e21c76e06be140bc85242fb62c'),
    ('20260816101000_decision_trace_nullable_references', '6d93254d40ad5e9e28e3ea4fb62b566dbad9244e395e4816ad543ebc27b66f6e'),
    ('20260816102000_decision_trace_revision_status', 'de5923e7a25c84753d39f7b50827cf3d5127857782ff5a5faa5dcb6046112768'),
    ('20260817120000_working_memory_maintain_job_type', '954bd7aa1b7899696c3393a90640f0a922edd3a6f15bd0887ccbf1234c729642'),
    ('20260817121000_memory_maintainer_v1_1_runtime', 'ae706773fdaab6c30c3a321c1d30bddff29a60aff035ae37bf27b6e63b174bfc'),
    ('20260817130000_memory_maintainer_review_fixes', 'ec04ff238a116fb7eccef10941d57f0d53ffffdc64b709575525112f01acbe9d'),
    ('20260818100000_memory_maintainer_v1_2_semantic_trigger', 'fbe78fa0a6accf252940a1c43bc7b8aa4ba54c6f756c83a1d8436d97caf3cf62'),
    ('20260818101000_decision_trace_memory_trigger_observation', 'c2870e1b9d70bf7b68140a6f1e4ae859d309eba206c634f7915d2965f386ba55')
  )
  SELECT count(*) INTO mismatch_count
  FROM expected e
  LEFT JOIN "_prisma_migrations" p
    ON p."migration_name" = e."migration_name" AND p."checksum" = e."checksum" AND p."finished_at" IS NOT NULL
  WHERE p."id" IS NULL;
  migration_mode := CASE WHEN EXISTS (SELECT 1 FROM "memory_resolution") THEN 'upgrade' ELSE 'fresh' END;
  IF mismatch_count <> 0 THEN
    INSERT INTO "memory_p2_migration_manifest"
      ("schema_version", "source_version", "target_version", "mode", "status", "predecessor_fingerprint", "expected_migration_count", "error_code")
    VALUES
      ('memory-persistence-p2c-v1', 'memory-maintainer-v1.2', 'memory-persistence-p2c-v1', migration_mode,
       'unavailable', '2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6', 26,
       'P2_MIGRATION_UNAVAILABLE')
    ON CONFLICT ("schema_version", "source_version", "target_version", "mode", "predecessor_fingerprint") DO NOTHING;
    RETURN;
  END IF;
  INSERT INTO "memory_p2_migration_manifest"
    ("schema_version", "source_version", "target_version", "mode", "status", "predecessor_fingerprint", "expected_migration_count", "completed_at")
  VALUES
    ('memory-persistence-p2c-v1', 'memory-maintainer-v1.2', 'memory-persistence-p2c-v1', migration_mode,
     CASE WHEN migration_mode = 'fresh' THEN 'completed' ELSE 'upgrading' END,
     '2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6', 26,
     CASE WHEN migration_mode = 'fresh' THEN CURRENT_TIMESTAMP ELSE NULL END)
  ON CONFLICT ("schema_version", "source_version", "target_version", "mode", "predecessor_fingerprint") DO NOTHING;
END $$;

COMMIT;

BEGIN;
SELECT "memory_p2_resume_migration"();
COMMIT;
