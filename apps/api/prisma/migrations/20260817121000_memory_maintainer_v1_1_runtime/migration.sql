CREATE TYPE "MemorySemanticKind" AS ENUM ('episode', 'fact');
CREATE TYPE "MemoryLayer" AS ENUM ('working', 'mid', 'long');
CREATE TYPE "MemorySemanticStatus" AS ENUM ('current', 'uncertain', 'disputed');
CREATE TYPE "MemoryThreadStatus" AS ENUM ('active', 'parked');
CREATE TYPE "MemoryBoundaryStatus" AS ENUM ('active', 'revoked', 'superseded');
CREATE TYPE "MemoryMaintenanceTriggerKind" AS ENUM ('batch_threshold', 'time_threshold', 'session_final_flush');
CREATE TYPE "MemoryMaintenanceMembershipKind" AS ENUM ('new', 'overlap');

ALTER TABLE "ai_job"
  ADD COLUMN "attempt_no" integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT "ai_job_attempt_no_positive" CHECK ("attempt_no" >= 1),
  ADD CONSTRAINT "ai_job_maintainer_trigger_namespace" CHECK (
    (
      "job_type" = 'working_memory_maintain'::"AiJobType"
      AND "trigger_dedupe_key" IS NOT NULL
      AND "trigger_dedupe_key" LIKE 'memory-p1-v1.1:%'
    ) OR (
      "job_type" <> 'working_memory_maintain'::"AiJobType"
      AND (
        "trigger_dedupe_key" IS NULL
        OR "trigger_dedupe_key" NOT LIKE 'memory-p1-v1.1:%'
      )
    )
  );

DROP INDEX "ai_job_trigger_dedupe_key_key";
CREATE INDEX "ai_job_trigger_dedupe_key_idx" ON "ai_job"("trigger_dedupe_key");
CREATE UNIQUE INDEX "ai_job_non_maintainer_trigger_dedupe_key"
  ON "ai_job"("trigger_dedupe_key")
  WHERE "trigger_dedupe_key" IS NOT NULL
    AND "job_type" <> 'working_memory_maintain'::"AiJobType";
CREATE UNIQUE INDEX "ai_job_working_memory_live_trigger_dedupe_key"
  ON "ai_job"("trigger_dedupe_key")
  WHERE "trigger_dedupe_key" IS NOT NULL
    AND "job_type" = 'working_memory_maintain'::"AiJobType"
    AND "status" IN ('pending'::"AiJobStatus", 'running'::"AiJobStatus", 'succeeded'::"AiJobStatus");
CREATE UNIQUE INDEX "ai_job_working_memory_trigger_attempt_key"
  ON "ai_job"("trigger_dedupe_key", "attempt_no")
  WHERE "trigger_dedupe_key" IS NOT NULL
    AND "job_type" = 'working_memory_maintain'::"AiJobType";

ALTER TABLE "memory_claim"
  ADD COLUMN "semantic_kind" "MemorySemanticKind",
  ADD COLUMN "layer" "MemoryLayer",
  ADD COLUMN "source_session_id" uuid,
  ADD COLUMN "thread_id" uuid,
  ADD CONSTRAINT "memory_claim_v1_1_authority_all_or_none" CHECK (
    ("semantic_kind" IS NULL AND "layer" IS NULL AND "source_session_id" IS NULL AND "thread_id" IS NULL)
    OR
    ("semantic_kind" IS NOT NULL AND "layer" IS NOT NULL AND "source_session_id" IS NOT NULL AND "thread_id" IS NOT NULL)
  );
ALTER TABLE "memory_resolution"
  ADD COLUMN "semantic_kind" "MemorySemanticKind",
  ADD COLUMN "layer" "MemoryLayer",
  ADD COLUMN "semantic_status" "MemorySemanticStatus",
  ADD COLUMN "source_session_id" uuid,
  ADD COLUMN "thread_id" uuid,
  ADD CONSTRAINT "memory_resolution_v1_1_authority_all_or_none" CHECK (
    ("semantic_kind" IS NULL AND "layer" IS NULL AND "semantic_status" IS NULL AND "source_session_id" IS NULL AND "thread_id" IS NULL)
    OR
    ("semantic_kind" IS NOT NULL AND "layer" IS NOT NULL AND "semantic_status" IS NOT NULL AND "source_session_id" IS NOT NULL AND "thread_id" IS NOT NULL)
  );

CREATE TABLE "memory_thread" (
  "id" uuid PRIMARY KEY,
  "project_id" uuid NOT NULL,
  "origin_session_id" uuid NOT NULL,
  "anchor_thread_id" uuid,
  "created_by_ai_job_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_thread_revision" (
  "id" uuid PRIMARY KEY,
  "thread_id" uuid NOT NULL,
  "source_session_id" uuid NOT NULL,
  "revision" integer NOT NULL CHECK ("revision" >= 1),
  "status" "MemoryThreadStatus" NOT NULL,
  "topic_key" varchar(240) NOT NULL,
  "supersedes_thread_revision_id" uuid,
  "superseded_at" timestamptz(3),
  "ai_job_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_boundary" (
  "id" uuid PRIMARY KEY,
  "project_id" uuid NOT NULL,
  "created_by_ai_job_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_boundary_revision" (
  "id" uuid PRIMARY KEY,
  "boundary_id" uuid NOT NULL,
  "revision" integer NOT NULL CHECK ("revision" >= 1),
  "code" varchar(80) NOT NULL CHECK ("code" = 'elder_explicit_boundary'),
  "abstract_scope" varchar(240) NOT NULL,
  "status" "MemoryBoundaryStatus" NOT NULL,
  "supersedes_boundary_revision_id" uuid,
  "superseded_at" timestamptz(3),
  "ai_job_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_boundary_evidence" (
  "id" uuid PRIMARY KEY,
  "boundary_revision_id" uuid NOT NULL,
  "ai_job_input_segment_id" uuid NOT NULL,
  "transcript_segment_id" uuid NOT NULL,
  "evidence_order" integer NOT NULL CHECK ("evidence_order" >= 0),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_maintenance_input_segment" (
  "id" uuid PRIMARY KEY,
  "ai_job_id" uuid NOT NULL,
  "ai_job_input_segment_id" uuid NOT NULL,
  "transcript_segment_id" uuid NOT NULL,
  "membership_kind" "MemoryMaintenanceMembershipKind" NOT NULL,
  "input_order" integer NOT NULL CHECK ("input_order" >= 0),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_working_snapshot" (
  "id" uuid PRIMARY KEY,
  "ai_job_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "source_session_id" uuid NOT NULL,
  "contract_version" varchar(80) NOT NULL CHECK ("contract_version" = 'memory-maintainer-v1.1'),
  "trigger_kind" "MemoryMaintenanceTriggerKind" NOT NULL,
  "trigger_identity" varchar(160) NOT NULL,
  "policy_revision" integer NOT NULL,
  "expected_resolution_count" integer NOT NULL CHECK ("expected_resolution_count" >= 0),
  "resolution_manifest_hash" char(64) NOT NULL,
  "expected_thread_count" integer NOT NULL CHECK ("expected_thread_count" >= 0),
  "thread_manifest_hash" char(64) NOT NULL,
  "expected_boundary_count" integer NOT NULL CHECK ("expected_boundary_count" >= 0),
  "boundary_manifest_hash" char(64) NOT NULL,
  "committed_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_working_snapshot_resolution" (
  "id" uuid PRIMARY KEY,
  "snapshot_id" uuid NOT NULL,
  "memory_resolution_id" uuid NOT NULL,
  "resolution_revision" integer NOT NULL CHECK ("resolution_revision" >= 1),
  "membership_digest" char(64) NOT NULL,
  "input_order" integer NOT NULL CHECK ("input_order" >= 0),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_working_snapshot_thread" (
  "id" uuid PRIMARY KEY,
  "snapshot_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "thread_revision_id" uuid NOT NULL,
  "revision" integer NOT NULL CHECK ("revision" >= 1),
  "membership_digest" char(64) NOT NULL,
  "input_order" integer NOT NULL CHECK ("input_order" >= 0),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_working_snapshot_boundary" (
  "id" uuid PRIMARY KEY,
  "snapshot_id" uuid NOT NULL,
  "boundary_id" uuid NOT NULL,
  "boundary_revision_id" uuid NOT NULL,
  "revision" integer NOT NULL CHECK ("revision" >= 1),
  "membership_digest" char(64) NOT NULL,
  "input_order" integer NOT NULL CHECK ("input_order" >= 0),
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "memory_working_consumption" (
  "id" uuid PRIMARY KEY,
  "project_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "transcript_segment_id" uuid NOT NULL,
  "text_revision" integer NOT NULL CHECK ("text_revision" >= 0),
  "effective_text_digest" char(64) NOT NULL,
  "memory_working_snapshot_id" uuid,
  "ai_job_input_segment_id" uuid,
  "created_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE INDEX "memory_claim_project_layer_semantic_idx" ON "memory_claim"("project_id", "layer", "semantic_kind");
CREATE INDEX "memory_resolution_project_layer_semantic_status_idx" ON "memory_resolution"("project_id", "layer", "semantic_kind", "semantic_status", "status");
CREATE INDEX "memory_thread_project_origin_idx" ON "memory_thread"("project_id", "origin_session_id");
CREATE UNIQUE INDEX "memory_thread_revision_thread_revision_key" ON "memory_thread_revision"("thread_id", "revision");
CREATE UNIQUE INDEX "memory_thread_revision_current_key" ON "memory_thread_revision"("thread_id") WHERE "superseded_at" IS NULL;
CREATE UNIQUE INDEX "memory_thread_revision_active_session_key" ON "memory_thread_revision"("source_session_id") WHERE "superseded_at" IS NULL AND "status" = 'active';
CREATE INDEX "memory_thread_revision_session_status_idx" ON "memory_thread_revision"("source_session_id", "status", "superseded_at");
CREATE INDEX "memory_boundary_project_idx" ON "memory_boundary"("project_id");
CREATE UNIQUE INDEX "memory_boundary_revision_boundary_revision_key" ON "memory_boundary_revision"("boundary_id", "revision");
CREATE UNIQUE INDEX "memory_boundary_revision_current_key" ON "memory_boundary_revision"("boundary_id") WHERE "superseded_at" IS NULL;
CREATE UNIQUE INDEX "memory_boundary_evidence_revision_input_key" ON "memory_boundary_evidence"("boundary_revision_id", "ai_job_input_segment_id");
CREATE UNIQUE INDEX "memory_boundary_evidence_revision_order_key" ON "memory_boundary_evidence"("boundary_revision_id", "evidence_order");
CREATE UNIQUE INDEX "memory_maintenance_input_segment_input_key" ON "memory_maintenance_input_segment"("ai_job_input_segment_id");
CREATE UNIQUE INDEX "memory_maintenance_input_segment_job_segment_key" ON "memory_maintenance_input_segment"("ai_job_id", "transcript_segment_id");
CREATE UNIQUE INDEX "memory_maintenance_input_segment_job_order_key" ON "memory_maintenance_input_segment"("ai_job_id", "input_order");
CREATE INDEX "memory_maintenance_input_segment_segment_kind_idx" ON "memory_maintenance_input_segment"("transcript_segment_id", "membership_kind");
CREATE UNIQUE INDEX "memory_working_snapshot_job_key" ON "memory_working_snapshot"("ai_job_id");
CREATE UNIQUE INDEX "memory_working_snapshot_trigger_key" ON "memory_working_snapshot"("trigger_identity");
CREATE INDEX "memory_working_snapshot_project_session_committed_idx" ON "memory_working_snapshot"("project_id", "source_session_id", "committed_at" DESC);
CREATE UNIQUE INDEX "memory_working_snapshot_resolution_member_key" ON "memory_working_snapshot_resolution"("snapshot_id", "memory_resolution_id");
CREATE UNIQUE INDEX "memory_working_snapshot_resolution_order_key" ON "memory_working_snapshot_resolution"("snapshot_id", "input_order");
CREATE UNIQUE INDEX "memory_working_snapshot_thread_member_key" ON "memory_working_snapshot_thread"("snapshot_id", "thread_id");
CREATE UNIQUE INDEX "memory_working_snapshot_thread_order_key" ON "memory_working_snapshot_thread"("snapshot_id", "input_order");
CREATE UNIQUE INDEX "memory_working_snapshot_boundary_member_key" ON "memory_working_snapshot_boundary"("snapshot_id", "boundary_id");
CREATE UNIQUE INDEX "memory_working_snapshot_boundary_order_key" ON "memory_working_snapshot_boundary"("snapshot_id", "input_order");
CREATE UNIQUE INDEX "memory_working_consumption_segment_key" ON "memory_working_consumption"("transcript_segment_id");
CREATE UNIQUE INDEX "memory_working_consumption_input_key" ON "memory_working_consumption"("ai_job_input_segment_id") WHERE "ai_job_input_segment_id" IS NOT NULL;
CREATE INDEX "memory_working_consumption_project_session_idx" ON "memory_working_consumption"("project_id", "session_id");

ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_source_session_fkey" FOREIGN KEY ("source_session_id") REFERENCES "interview_session"("id") ON DELETE SET NULL;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_source_session_fkey" FOREIGN KEY ("source_session_id") REFERENCES "interview_session"("id") ON DELETE SET NULL;
ALTER TABLE "memory_thread" ADD CONSTRAINT "memory_thread_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "memory_thread" ADD CONSTRAINT "memory_thread_origin_session_fkey" FOREIGN KEY ("origin_session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "memory_thread" ADD CONSTRAINT "memory_thread_anchor_fkey" FOREIGN KEY ("anchor_thread_id") REFERENCES "memory_thread"("id") ON DELETE SET NULL;
ALTER TABLE "memory_thread" ADD CONSTRAINT "memory_thread_created_job_fkey" FOREIGN KEY ("created_by_ai_job_id") REFERENCES "ai_job"("id") ON DELETE SET NULL;
ALTER TABLE "memory_thread_revision" ADD CONSTRAINT "memory_thread_revision_thread_fkey" FOREIGN KEY ("thread_id") REFERENCES "memory_thread"("id") ON DELETE CASCADE;
ALTER TABLE "memory_thread_revision" ADD CONSTRAINT "memory_thread_revision_session_fkey" FOREIGN KEY ("source_session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "memory_thread_revision" ADD CONSTRAINT "memory_thread_revision_supersedes_fkey" FOREIGN KEY ("supersedes_thread_revision_id") REFERENCES "memory_thread_revision"("id") ON DELETE SET NULL;
ALTER TABLE "memory_thread_revision" ADD CONSTRAINT "memory_thread_revision_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE SET NULL;
ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_thread_fkey" FOREIGN KEY ("thread_id") REFERENCES "memory_thread"("id") ON DELETE SET NULL;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_thread_fkey" FOREIGN KEY ("thread_id") REFERENCES "memory_thread"("id") ON DELETE SET NULL;
ALTER TABLE "memory_boundary" ADD CONSTRAINT "memory_boundary_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "memory_boundary" ADD CONSTRAINT "memory_boundary_created_job_fkey" FOREIGN KEY ("created_by_ai_job_id") REFERENCES "ai_job"("id") ON DELETE SET NULL;
ALTER TABLE "memory_boundary_revision" ADD CONSTRAINT "memory_boundary_revision_boundary_fkey" FOREIGN KEY ("boundary_id") REFERENCES "memory_boundary"("id") ON DELETE CASCADE;
ALTER TABLE "memory_boundary_revision" ADD CONSTRAINT "memory_boundary_revision_supersedes_fkey" FOREIGN KEY ("supersedes_boundary_revision_id") REFERENCES "memory_boundary_revision"("id") ON DELETE SET NULL;
ALTER TABLE "memory_boundary_revision" ADD CONSTRAINT "memory_boundary_revision_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE SET NULL;
ALTER TABLE "memory_boundary_evidence" ADD CONSTRAINT "memory_boundary_evidence_revision_fkey" FOREIGN KEY ("boundary_revision_id") REFERENCES "memory_boundary_revision"("id") ON DELETE CASCADE;
ALTER TABLE "memory_boundary_evidence" ADD CONSTRAINT "memory_boundary_evidence_input_fkey" FOREIGN KEY ("ai_job_input_segment_id") REFERENCES "ai_job_input_segment"("id") ON DELETE CASCADE;
ALTER TABLE "memory_boundary_evidence" ADD CONSTRAINT "memory_boundary_evidence_segment_fkey" FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segment"("id") ON DELETE CASCADE;
ALTER TABLE "memory_maintenance_input_segment" ADD CONSTRAINT "memory_maintenance_input_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "memory_maintenance_input_segment" ADD CONSTRAINT "memory_maintenance_input_fkey" FOREIGN KEY ("ai_job_input_segment_id") REFERENCES "ai_job_input_segment"("id") ON DELETE CASCADE;
ALTER TABLE "memory_maintenance_input_segment" ADD CONSTRAINT "memory_maintenance_segment_fkey" FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segment"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot" ADD CONSTRAINT "memory_working_snapshot_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot" ADD CONSTRAINT "memory_working_snapshot_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot" ADD CONSTRAINT "memory_working_snapshot_session_fkey" FOREIGN KEY ("source_session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot_resolution" ADD CONSTRAINT "memory_working_snapshot_resolution_snapshot_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "memory_working_snapshot"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot_resolution" ADD CONSTRAINT "memory_working_snapshot_resolution_memory_fkey" FOREIGN KEY ("memory_resolution_id") REFERENCES "memory_resolution"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot_thread" ADD CONSTRAINT "memory_working_snapshot_thread_snapshot_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "memory_working_snapshot"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot_thread" ADD CONSTRAINT "memory_working_snapshot_thread_thread_fkey" FOREIGN KEY ("thread_id") REFERENCES "memory_thread"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot_thread" ADD CONSTRAINT "memory_working_snapshot_thread_revision_fkey" FOREIGN KEY ("thread_revision_id") REFERENCES "memory_thread_revision"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot_boundary" ADD CONSTRAINT "memory_working_snapshot_boundary_snapshot_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "memory_working_snapshot"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot_boundary" ADD CONSTRAINT "memory_working_snapshot_boundary_boundary_fkey" FOREIGN KEY ("boundary_id") REFERENCES "memory_boundary"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_snapshot_boundary" ADD CONSTRAINT "memory_working_snapshot_boundary_revision_fkey" FOREIGN KEY ("boundary_revision_id") REFERENCES "memory_boundary_revision"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_consumption" ADD CONSTRAINT "memory_working_consumption_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_consumption" ADD CONSTRAINT "memory_working_consumption_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_consumption" ADD CONSTRAINT "memory_working_consumption_segment_fkey" FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segment"("id") ON DELETE CASCADE;
ALTER TABLE "memory_working_consumption" ADD CONSTRAINT "memory_working_consumption_snapshot_fkey" FOREIGN KEY ("memory_working_snapshot_id") REFERENCES "memory_working_snapshot"("id") ON DELETE SET NULL;
ALTER TABLE "memory_working_consumption" ADD CONSTRAINT "memory_working_consumption_input_fkey" FOREIGN KEY ("ai_job_input_segment_id") REFERENCES "ai_job_input_segment"("id") ON DELETE SET NULL;

CREATE FUNCTION verify_memory_working_consumption_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A deferred UPDATE event can outlive the row when the same transaction later
  -- deletes the owning transcript and cascades the consumption.
  IF NOT EXISTS (SELECT 1 FROM memory_working_consumption WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM transcript_segment s
    JOIN interview_session i ON i.id = s.session_id
    WHERE s.id = NEW.transcript_segment_id
      AND s.session_id = NEW.session_id
      AND i.project_id = NEW.project_id
      AND s.text_revision = NEW.text_revision
  ) THEN
    RAISE EXCEPTION 'memory working consumption scope/revision mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "memory_working_consumption_scope_deferred"
  AFTER INSERT OR UPDATE ON "memory_working_consumption"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verify_memory_working_consumption_scope();

CREATE FUNCTION verify_memory_maintainer_retry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  predecessor "ai_job"%ROWTYPE;
BEGIN
  IF NEW."job_type" <> 'working_memory_maintain'::"AiJobType" THEN
    RETURN NEW;
  END IF;
  IF NEW."attempt_no" = 1 AND NEW."retry_of_job_id" IS NOT NULL THEN
    RAISE EXCEPTION 'first memory maintainer attempt cannot have predecessor';
  END IF;
  IF NEW."attempt_no" > 1 THEN
    IF NEW."retry_of_job_id" IS NULL THEN
      RAISE EXCEPTION 'memory maintainer retry predecessor required';
    END IF;
    SELECT * INTO predecessor FROM "ai_job" WHERE "id" = NEW."retry_of_job_id";
    IF predecessor."id" IS NULL
      OR predecessor."job_type" <> 'working_memory_maintain'::"AiJobType"
      OR predecessor."status" <> 'failed'::"AiJobStatus"
      OR predecessor."project_id" <> NEW."project_id"
      OR predecessor."requested_by" <> NEW."requested_by"
      OR predecessor."trigger_dedupe_key" <> NEW."trigger_dedupe_key"
      OR predecessor."attempt_no" + 1 <> NEW."attempt_no"
    THEN
      RAISE EXCEPTION 'invalid memory maintainer retry predecessor';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "ai_job_memory_maintainer_retry_deferred"
  AFTER INSERT OR UPDATE OF "attempt_no", "retry_of_job_id", "status" ON "ai_job"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verify_memory_maintainer_retry();
