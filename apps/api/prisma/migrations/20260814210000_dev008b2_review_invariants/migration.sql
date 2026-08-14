ALTER TABLE "interview_context_snapshot"
  ADD COLUMN "basis_session_id" UUID,
  ADD COLUMN "basis_analysis_trigger_identity" VARCHAR(160),
  ADD COLUMN "calibration_gate_identity" VARCHAR(240),
  ADD COLUMN "calibration_confirmed" BOOLEAN,
  ADD COLUMN "memory_lane_outcome" VARCHAR(16),
  ADD COLUMN "memory_lane_job_id" UUID,
  ADD COLUMN "actual_lane_outcome" VARCHAR(16),
  ADD COLUMN "actual_lane_job_id" UUID;

ALTER TABLE "interview_context_snapshot"
  ADD CONSTRAINT "context_snapshot_opening_provenance_check" CHECK (
    (
      "basis_session_id" IS NULL AND
      "basis_analysis_trigger_identity" IS NULL AND
      "calibration_gate_identity" IS NULL AND
      "calibration_confirmed" IS NULL AND
      "memory_lane_outcome" IS NULL AND
      "memory_lane_job_id" IS NULL AND
      "actual_lane_outcome" IS NULL AND
      "actual_lane_job_id" IS NULL
    ) OR (
      "basis_session_id" IS NOT NULL AND
      "basis_analysis_trigger_identity" IS NOT NULL AND
      "calibration_gate_identity" IS NOT NULL AND
      "calibration_confirmed" IS NOT NULL AND
      "memory_lane_outcome" IN ('succeeded', 'unjudged', 'failed', 'cancelled', 'unavailable') AND
      "memory_lane_job_id" IS NOT NULL AND
      "actual_lane_outcome" IN ('succeeded', 'unjudged', 'failed', 'cancelled', 'unavailable') AND
      "actual_lane_job_id" IS NOT NULL
    )
  );

CREATE INDEX "interview_context_snapshot_consumer_opening_idx"
  ON "interview_context_snapshot"("consumer_session_id", "created_at" DESC)
  WHERE "basis_session_id" IS NOT NULL;

ALTER TABLE "question_generation_attempt"
  ADD COLUMN "interview_context_snapshot_id" UUID;

ALTER TABLE "question_generation_attempt"
  ADD CONSTRAINT "question_attempt_opening_context_check" CHECK (
    (
      "attempt_kind" = 'second_session_opening' AND
      (
        "interview_context_snapshot_id" IS NOT NULL OR
        ("status" = 'failed' AND "result_kind" = 'unavailable')
      )
    ) OR
    ("attempt_kind" <> 'second_session_opening' AND "interview_context_snapshot_id" IS NULL)
  ) NOT VALID;
