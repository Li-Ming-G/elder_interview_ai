ALTER TABLE "decision_trace"
  ALTER COLUMN "working_revision" DROP NOT NULL;

ALTER TABLE "decision_trace_memory_membership"
  ALTER COLUMN "revision" DROP NOT NULL;

ALTER TABLE "decision_trace_p4_membership"
  ALTER COLUMN "source_id" TYPE VARCHAR(160) USING "source_id"::text,
  ALTER COLUMN "revision" DROP NOT NULL;

ALTER TABLE "decision_trace_p4_membership"
  ADD COLUMN IF NOT EXISTS "revision_status" VARCHAR(16) NOT NULL DEFAULT 'unavailable';
