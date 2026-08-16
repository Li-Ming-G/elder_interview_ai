ALTER TABLE "decision_trace_p4_membership"
  ADD COLUMN IF NOT EXISTS "revision_status" VARCHAR(16) NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS "source_version" VARCHAR(80);

UPDATE "decision_trace_p4_membership"
SET "revision_status" = CASE WHEN "revision" IS NULL THEN 'unavailable' ELSE 'available' END;

ALTER TABLE "decision_trace_p4_membership"
  ALTER COLUMN "revision_status" DROP DEFAULT;

ALTER TABLE "decision_trace_p4_membership"
  ADD CONSTRAINT "decision_trace_p4_revision_status_check" CHECK (
    ("revision_status" = 'available' AND "revision" IS NOT NULL)
    OR ("revision_status" = 'unavailable' AND "revision" IS NULL)
  );

ALTER TABLE "decision_trace"
  ADD COLUMN "publication_outcome" VARCHAR(40);

ALTER TABLE "decision_trace"
  ADD CONSTRAINT "decision_trace_publication_outcome_check" CHECK (
    "publication_outcome" IS NULL OR "publication_outcome" IN (
      'published',
      'not_better',
      'duplicate_filtered',
      'stale_basis',
      'superseded_by_manual',
      'policy_blocked',
      'not_applicable'
    )
  );

CREATE TABLE "ai_job_input_actual_question" (
  "id" UUID NOT NULL,
  "ai_job_id" UUID NOT NULL,
  "actual_question_id" UUID NOT NULL,
  "actual_question_analysis_id" UUID NOT NULL,
  "analysis_revision" INTEGER NOT NULL,
  "normalized_digest" CHAR(64) NOT NULL,
  "input_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_job_input_actual_question_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_job_input_actual_question_job_question_key"
  ON "ai_job_input_actual_question"("ai_job_id", "actual_question_id");
CREATE UNIQUE INDEX "ai_job_input_actual_question_job_order_key"
  ON "ai_job_input_actual_question"("ai_job_id", "input_order");

ALTER TABLE "ai_job_input_actual_question"
  ADD CONSTRAINT "ai_job_actual_question_job_fkey" FOREIGN KEY ("ai_job_id")
  REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "ai_job_input_actual_question"
  ADD CONSTRAINT "ai_job_actual_question_question_fkey" FOREIGN KEY ("actual_question_id")
  REFERENCES "actual_question"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_job_input_actual_question"
  ADD CONSTRAINT "ai_job_actual_question_analysis_fkey" FOREIGN KEY ("actual_question_analysis_id")
  REFERENCES "actual_question_analysis"("id") ON DELETE RESTRICT;

INSERT INTO "ai_job_input_actual_question" (
  "id",
  "ai_job_id",
  "actual_question_id",
  "actual_question_analysis_id",
  "analysis_revision",
  "normalized_digest",
  "input_order"
)
SELECT
  gen_random_uuid(),
  attempt."ai_job_id",
  membership."actual_question_id",
  question."actual_question_analysis_id",
  analysis."analysis_revision",
  question."normalized_digest",
  membership."input_order"
FROM "question_generation_attempt" attempt
JOIN "context_snapshot_actual_question" membership
  ON membership."context_snapshot_id" = attempt."interview_context_snapshot_id"
JOIN "actual_question" question ON question."id" = membership."actual_question_id"
JOIN "actual_question_analysis" analysis ON analysis."id" = question."actual_question_analysis_id"
ON CONFLICT DO NOTHING;
