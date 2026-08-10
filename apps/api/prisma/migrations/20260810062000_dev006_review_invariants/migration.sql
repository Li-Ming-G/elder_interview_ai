-- DEV-006 directed-review follow-up. Existing branch-only AI rows predate the
-- complete input identity, so they are retained as cancelled process evidence
-- rather than being assigned a fabricated eligible identity.
ALTER TABLE "ai_job"
  ADD COLUMN "trigger_dedupe_key" varchar(160),
  ADD COLUMN "retry_of_job_id" uuid,
  ADD COLUMN "request_identity_hash" char(64),
  ADD COLUMN "input_hash" char(64);

UPDATE "ai_job"
SET "input_hash" = repeat('0', 64),
    "request_identity_hash" = repeat('0', 64),
    "status" = CASE WHEN "status" IN ('pending', 'running', 'succeeded') THEN 'cancelled' ELSE "status" END,
    "failure_code" = CASE WHEN "status" IN ('pending', 'running', 'succeeded') THEN 'LEGACY_INPUT_IDENTITY_MISSING' ELSE "failure_code" END,
    "completed_at" = CASE WHEN "status" IN ('pending', 'running', 'succeeded') THEN COALESCE("completed_at", now()) ELSE "completed_at" END
WHERE "input_hash" IS NULL;

ALTER TABLE "ai_job" ALTER COLUMN "input_hash" SET NOT NULL;
ALTER TABLE "ai_job" ALTER COLUMN "request_identity_hash" SET NOT NULL;
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_input_hash_check"
  CHECK ("input_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_request_identity_hash_check"
  CHECK ("request_identity_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_retry_not_self_check"
  CHECK ("retry_of_job_id" IS NULL OR "retry_of_job_id" <> "id");
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_retry_of_fkey"
  FOREIGN KEY ("retry_of_job_id") REFERENCES "ai_job"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "ai_job_trigger_dedupe_key_key"
  ON "ai_job"("trigger_dedupe_key") WHERE "trigger_dedupe_key" IS NOT NULL;
CREATE INDEX "ai_job_retry_of_job_id_idx" ON "ai_job"("retry_of_job_id");

ALTER TABLE "ai_job_session_scope"
  ADD COLUMN "max_segment_start_ms" integer,
  ADD COLUMN "max_segment_id" uuid,
  ADD COLUMN "scope_reason" varchar(80) NOT NULL DEFAULT 'legacy_unverified';

UPDATE "ai_job_session_scope" scope
SET ("max_segment_start_ms", "max_segment_id") = (
  SELECT segment."start_ms", segment."id"
  FROM "transcript_segment" segment
  WHERE segment."session_id" = scope."session_id"
  ORDER BY segment."start_ms" DESC, segment."id" DESC
  LIMIT 1
);

ALTER TABLE "ai_job_session_scope" ALTER COLUMN "scope_reason" DROP DEFAULT;
ALTER TABLE "ai_job_session_scope" ADD CONSTRAINT "ai_job_scope_watermark_pair_check"
  CHECK (("max_segment_start_ms" IS NULL) = ("max_segment_id" IS NULL));

CREATE FUNCTION verify_ai_job_scope_final_watermark() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actual_start_ms integer;
  actual_id uuid;
BEGIN
  SELECT segment."start_ms", segment."id"
  INTO actual_start_ms, actual_id
  FROM "transcript_segment" segment
  WHERE segment."session_id" = NEW."session_id"
  ORDER BY segment."start_ms" DESC, segment."id" DESC
  LIMIT 1;

  IF actual_id IS NULL THEN
    IF NEW."max_segment_start_ms" IS NOT NULL OR NEW."max_segment_id" IS NOT NULL THEN
      RAISE EXCEPTION 'AI_JOB_SCOPE_WATERMARK_WITHOUT_FINAL';
    END IF;
  ELSIF NEW."max_segment_start_ms" IS DISTINCT FROM actual_start_ms
     OR NEW."max_segment_id" IS DISTINCT FROM actual_id THEN
    RAISE EXCEPTION 'AI_JOB_SCOPE_FINAL_WATERMARK_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER "ai_job_scope_final_watermark_deferred"
AFTER INSERT OR UPDATE OF "session_id", "max_segment_start_ms", "max_segment_id"
ON "ai_job_session_scope" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_ai_job_scope_final_watermark();

ALTER TABLE "interview_context_snapshot"
  ADD COLUMN "memory_count" integer,
  ADD COLUMN "actual_question_count" integer;

UPDATE "interview_context_snapshot" snapshot
SET "memory_count" = (
      SELECT count(*) FROM "context_snapshot_memory" item
      WHERE item."context_snapshot_id" = snapshot."id"
    ),
    "actual_question_count" = (
      SELECT count(*) FROM "context_snapshot_actual_question" item
      WHERE item."context_snapshot_id" = snapshot."id"
    );

ALTER TABLE "interview_context_snapshot"
  ALTER COLUMN "memory_count" SET NOT NULL,
  ALTER COLUMN "actual_question_count" SET NOT NULL,
  ADD CONSTRAINT "context_snapshot_counts_nonnegative"
    CHECK ("memory_count" >= 0 AND "actual_question_count" >= 0);
