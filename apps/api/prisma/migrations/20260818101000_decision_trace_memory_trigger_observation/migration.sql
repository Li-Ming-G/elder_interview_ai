BEGIN;

CREATE TABLE "decision_trace_memory_trigger_observation" (
  "id" UUID NOT NULL,
  "trace_id" UUID NOT NULL,
  "ai_job_id" UUID NOT NULL,
  "observation_version" VARCHAR(48) NOT NULL,
  "useful_character_policy_version" VARCHAR(64) NOT NULL,
  "trigger_identity" VARCHAR(160) NOT NULL,
  "trigger_kind" VARCHAR(32) NOT NULL,
  "selected_new_segment_count" INTEGER NOT NULL,
  "cumulative_useful_characters" INTEGER NOT NULL,
  "minimum_useful_characters" INTEGER NOT NULL,
  "selected_new_manifest_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_trace_memory_trigger_observation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_trace_memory_trigger_observation_version_check" CHECK (
    "observation_version" = 'decision-trace-memory-trigger-v1'
  ),
  CONSTRAINT "decision_trace_memory_trigger_useful_policy_check" CHECK (
    "useful_character_policy_version" = 'memory-useful-characters-nfkc-ws-codepoint-v1'
  ),
  CONSTRAINT "decision_trace_memory_trigger_kind_check" CHECK (
    "trigger_kind" IN ('batch_threshold', 'time_threshold', 'session_final_flush')
  ),
  CONSTRAINT "decision_trace_memory_trigger_counts_check" CHECK (
    "selected_new_segment_count" >= 0
    AND "cumulative_useful_characters" >= 0
    AND "minimum_useful_characters" > 0
  ),
  CONSTRAINT "decision_trace_memory_trigger_manifest_check" CHECK (
    "selected_new_manifest_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "decision_trace_memory_trigger_identity_check" CHECK (
    "trigger_identity" LIKE 'memory-p1-v1.2:%'
  )
);

CREATE TABLE "decision_trace_memory_trigger_segment_membership" (
  "id" UUID NOT NULL,
  "observation_id" UUID NOT NULL,
  "transcript_segment_id" UUID NOT NULL,
  "text_revision" INTEGER NOT NULL,
  "speaker_role_revision" INTEGER NOT NULL,
  "effective_text_digest" CHAR(64) NOT NULL,
  "useful_character_count" INTEGER NOT NULL,
  "input_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_trace_memory_trigger_segment_membership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_trace_memory_trigger_segment_revision_check" CHECK (
    "text_revision" >= 0
    AND "speaker_role_revision" >= 0
    AND "useful_character_count" >= 0
    AND "input_order" >= 0
  ),
  CONSTRAINT "decision_trace_memory_trigger_segment_digest_check" CHECK (
    "effective_text_digest" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "decision_trace_memory_trigger_observation_trace_key"
  ON "decision_trace_memory_trigger_observation"("trace_id");
CREATE UNIQUE INDEX "decision_trace_memory_trigger_observation_job_key"
  ON "decision_trace_memory_trigger_observation"("ai_job_id");
CREATE INDEX "decision_trace_memory_trigger_observation_identity_idx"
  ON "decision_trace_memory_trigger_observation"("trigger_identity");
CREATE UNIQUE INDEX "decision_trace_memory_trigger_segment_observation_segment_key"
  ON "decision_trace_memory_trigger_segment_membership"("observation_id", "transcript_segment_id");
CREATE UNIQUE INDEX "decision_trace_memory_trigger_segment_observation_order_key"
  ON "decision_trace_memory_trigger_segment_membership"("observation_id", "input_order");
CREATE INDEX "decision_trace_memory_trigger_segment_source_idx"
  ON "decision_trace_memory_trigger_segment_membership"("transcript_segment_id");

ALTER TABLE "decision_trace_memory_trigger_observation"
  ADD CONSTRAINT "decision_trace_memory_trigger_observation_trace_fkey"
  FOREIGN KEY ("trace_id") REFERENCES "decision_trace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "decision_trace_memory_trigger_segment_membership"
  ADD CONSTRAINT "decision_trace_memory_trigger_segment_observation_fkey"
  FOREIGN KEY ("observation_id") REFERENCES "decision_trace_memory_trigger_observation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
