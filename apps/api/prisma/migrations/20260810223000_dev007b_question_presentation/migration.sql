-- DEV-007B v2: free-generation Director provenance and canonical presentation.
-- Question-bank rows are optional input references, never a generation whitelist.
ALTER TABLE "ai_provider_call" DROP CONSTRAINT "ai_provider_call_kind_check";
ALTER TABLE "ai_provider_call"
  ADD CONSTRAINT "ai_provider_call_kind_check"
    CHECK ("call_kind" IN ('primary', 'same_input_retry', 'format_repair'));

ALTER TABLE "question_generation_attempt"
  ADD COLUMN "journey_stage" varchar(24) NOT NULL,
  ADD COLUMN "journey_policy_version" varchar(80) NOT NULL,
  ADD COLUMN "journey_reason_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN "journey_basis_hash" char(64) NOT NULL,
  ADD COLUMN "prompt_bundle_version" varchar(80) NOT NULL,
  ADD COLUMN "prompt_bundle_digest" char(64) NOT NULL,
  ADD COLUMN "context_schema_version" varchar(80) NOT NULL,
  ADD COLUMN "context_schema_digest" char(64) NOT NULL,
  ADD COLUMN "output_schema_version" varchar(80) NOT NULL,
  ADD COLUMN "output_schema_digest" char(64) NOT NULL,
  ADD COLUMN "context_builder_version" varchar(80) NOT NULL,
  ADD COLUMN "context_builder_digest" char(64) NOT NULL,
  ADD COLUMN "model_config_version" varchar(80) NOT NULL,
  ADD COLUMN "model_config_digest" char(64) NOT NULL;

ALTER TABLE "question_candidate"
  DROP COLUMN "confidence",
  ADD COLUMN "generation_origin" varchar(24) NOT NULL,
  ADD COLUMN "journey_stage" varchar(24) NOT NULL,
  ADD COLUMN "journey_policy_version" varchar(80) NOT NULL;

ALTER TABLE "question_display_snapshot"
  ADD COLUMN "purpose" varchar(40) NOT NULL,
  ADD COLUMN "journey_stage" varchar(24) NOT NULL,
  ADD COLUMN "journey_policy_version" varchar(80) NOT NULL;

ALTER TABLE "question_generation_attempt"
  ADD CONSTRAINT "question_attempt_journey_stage_check"
    CHECK ("journey_stage" IN ('rapport', 'life_outline', 'story_depth')),
  ADD CONSTRAINT "question_attempt_version_digest_check"
    CHECK (
      "journey_basis_hash" ~ '^[0-9a-f]{64}$' AND
      "prompt_bundle_digest" ~ '^[0-9a-f]{64}$' AND
      "context_schema_digest" ~ '^[0-9a-f]{64}$' AND
      "output_schema_digest" ~ '^[0-9a-f]{64}$' AND
      "context_builder_digest" ~ '^[0-9a-f]{64}$' AND
      "model_config_digest" ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE "question_candidate"
  ADD CONSTRAINT "question_candidate_generation_origin_check"
    CHECK ("generation_origin" = 'model_generated'),
  ADD CONSTRAINT "question_candidate_journey_stage_check"
    CHECK ("journey_stage" IN ('rapport', 'life_outline', 'story_depth'));

ALTER TABLE "question_display_snapshot"
  ADD CONSTRAINT "question_snapshot_journey_stage_check"
    CHECK ("journey_stage" IN ('rapport', 'life_outline', 'story_depth'));

CREATE TABLE "question_generation_bank_input_membership" (
  "id" uuid PRIMARY KEY,
  "ai_job_id" uuid NOT NULL REFERENCES "ai_job"("id") ON DELETE CASCADE,
  "question_bank_item_id" uuid REFERENCES "question_bank_item"("id") ON DELETE SET NULL,
  "input_order" integer NOT NULL CHECK ("input_order" >= 0),
  "question_id" varchar(120) NOT NULL,
  "bank_version" varchar(80) NOT NULL,
  "content_digest" char(64) NOT NULL CHECK ("content_digest" ~ '^[0-9a-f]{64}$'),
  "license_status" varchar(24) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE ("ai_job_id", "input_order"),
  UNIQUE ("ai_job_id", "question_bank_item_id")
);

CREATE TABLE "question_candidate_bank_reference" (
  "id" uuid PRIMARY KEY,
  "question_candidate_id" uuid NOT NULL REFERENCES "question_candidate"("id") ON DELETE CASCADE,
  "question_bank_item_id" uuid REFERENCES "question_bank_item"("id") ON DELETE SET NULL,
  "question_id" varchar(120) NOT NULL,
  "bank_version" varchar(80) NOT NULL,
  "bank" varchar(16) NOT NULL CHECK ("bank" IN ('basic', 'deep')),
  "purpose" varchar(40) NOT NULL,
  "reference_usage" varchar(24) NOT NULL CHECK ("reference_usage" IN ('inspiration', 'adapted', 'verbatim')),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE ("question_candidate_id", "question_bank_item_id")
);

CREATE INDEX "question_attempt_session_status_idx"
  ON "question_generation_attempt"("session_id", "attempt_kind", "status");
CREATE INDEX "question_bank_input_job_idx"
  ON "question_generation_bank_input_membership"("ai_job_id", "input_order");
CREATE INDEX "question_candidate_reference_candidate_idx"
  ON "question_candidate_bank_reference"("question_candidate_id");

CREATE UNIQUE INDEX "question_attempt_one_active_manual_idx"
  ON "question_generation_attempt"("session_id")
  WHERE "attempt_kind" = 'manual_next' AND "status" IN ('pending', 'running');
CREATE UNIQUE INDEX "question_attempt_one_active_auto_idx"
  ON "question_generation_attempt"("session_id")
  WHERE "attempt_kind" = 'automatic' AND "status" IN ('pending', 'running');

CREATE FUNCTION verify_question_candidate_reference_seen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempt_job_id uuid;
  seen record;
BEGIN
  SELECT a."ai_job_id" INTO attempt_job_id
  FROM "question_candidate" c
  JOIN "question_generation_attempt" a ON a."id" = c."question_generation_attempt_id"
  WHERE c."id" = NEW."question_candidate_id";

  SELECT * INTO seen
  FROM "question_generation_bank_input_membership" m
  WHERE m."ai_job_id" = attempt_job_id
    AND m."question_bank_item_id" = NEW."question_bank_item_id";

  IF seen IS NULL
     OR seen."question_id" IS DISTINCT FROM NEW."question_id"
     OR seen."bank_version" IS DISTINCT FROM NEW."bank_version" THEN
    RAISE EXCEPTION 'QUESTION_CANDIDATE_BANK_REFERENCE_NOT_SEEN';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER "question_candidate_reference_seen_deferred"
AFTER INSERT OR UPDATE ON "question_candidate_bank_reference"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION verify_question_candidate_reference_seen();

CREATE FUNCTION verify_question_snapshot_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate "question_candidate"%ROWTYPE;
BEGIN
  IF NEW."question_candidate_id" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO candidate FROM "question_candidate" WHERE "id" = NEW."question_candidate_id";
  IF candidate."purpose" IS DISTINCT FROM NEW."purpose"
     OR candidate."journey_stage" IS DISTINCT FROM NEW."journey_stage"
     OR candidate."journey_policy_version" IS DISTINCT FROM NEW."journey_policy_version" THEN
    RAISE EXCEPTION 'QUESTION_SNAPSHOT_PROVENANCE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER "question_snapshot_provenance_deferred"
AFTER INSERT OR UPDATE ON "question_display_snapshot"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION verify_question_snapshot_provenance();
