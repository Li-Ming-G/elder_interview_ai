-- DEV-007B extends the DEV-006 QuestionEvidence owner with the provenance frozen
-- by ADR-030. The release/item tables remain owned by DEV-007A and are not changed.
ALTER TABLE "question_generation_attempt"
  ADD COLUMN "journey_stage" varchar(24) NOT NULL,
  ADD COLUMN "journey_policy_version" varchar(80) NOT NULL,
  ADD COLUMN "journey_reason_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN "journey_basis_hash" char(64) NOT NULL;

ALTER TABLE "question_candidate"
  ADD COLUMN "source_question_bank_item_id" uuid NOT NULL,
  ADD COLUMN "source_question_id" varchar(120) NOT NULL,
  ADD COLUMN "source_bank_version" varchar(80) NOT NULL,
  ADD COLUMN "source_bank" varchar(16) NOT NULL,
  ADD COLUMN "selection_mode" varchar(24) NOT NULL,
  ADD COLUMN "adaptation_reason_code" varchar(40),
  ADD COLUMN "journey_stage" varchar(24) NOT NULL,
  ADD COLUMN "journey_policy_version" varchar(80) NOT NULL;

ALTER TABLE "question_display_snapshot"
  ADD COLUMN "source_question_id" varchar(120) NOT NULL,
  ADD COLUMN "source_bank_version" varchar(80) NOT NULL,
  ADD COLUMN "source_bank" varchar(16) NOT NULL,
  ADD COLUMN "selection_mode" varchar(24) NOT NULL,
  ADD COLUMN "adaptation_reason_code" varchar(40),
  ADD COLUMN "purpose" varchar(40) NOT NULL,
  ADD COLUMN "journey_stage" varchar(24) NOT NULL,
  ADD COLUMN "journey_policy_version" varchar(80) NOT NULL;

ALTER TABLE "question_generation_attempt"
  ADD CONSTRAINT "question_attempt_journey_stage_check"
    CHECK ("journey_stage" IN ('rapport', 'life_outline', 'story_depth')),
  ADD CONSTRAINT "question_attempt_journey_hash_check"
    CHECK ("journey_basis_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "question_candidate"
  ADD CONSTRAINT "question_candidate_source_item_fkey"
    FOREIGN KEY ("source_question_bank_item_id") REFERENCES "question_bank_item"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "question_candidate_source_bank_check"
    CHECK ("source_bank" IN ('basic', 'deep')),
  ADD CONSTRAINT "question_candidate_selection_mode_check"
    CHECK ("selection_mode" IN ('verbatim', 'lightly_adapted')),
  ADD CONSTRAINT "question_candidate_adaptation_check"
    CHECK (
      ("selection_mode" = 'verbatim' AND "adaptation_reason_code" IS NULL) OR
      ("selection_mode" = 'lightly_adapted' AND "adaptation_reason_code" IN ('surface_wording', 'grounded_slot_fill'))
    ),
  ADD CONSTRAINT "question_candidate_journey_stage_check"
    CHECK ("journey_stage" IN ('rapport', 'life_outline', 'story_depth'));

ALTER TABLE "question_display_snapshot"
  ADD CONSTRAINT "question_snapshot_source_bank_check"
    CHECK ("source_bank" IN ('basic', 'deep')),
  ADD CONSTRAINT "question_snapshot_selection_mode_check"
    CHECK ("selection_mode" IN ('verbatim', 'lightly_adapted')),
  ADD CONSTRAINT "question_snapshot_adaptation_check"
    CHECK (
      ("selection_mode" = 'verbatim' AND "adaptation_reason_code" IS NULL) OR
      ("selection_mode" = 'lightly_adapted' AND "adaptation_reason_code" IN ('surface_wording', 'grounded_slot_fill'))
    ),
  ADD CONSTRAINT "question_snapshot_journey_stage_check"
    CHECK ("journey_stage" IN ('rapport', 'life_outline', 'story_depth'));

CREATE INDEX "question_attempt_session_status_idx"
  ON "question_generation_attempt"("session_id", "attempt_kind", "status");
CREATE INDEX "question_candidate_source_item_idx"
  ON "question_candidate"("source_question_bank_item_id");

CREATE FUNCTION verify_question_candidate_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_item "question_bank_item"%ROWTYPE;
  source_release "question_bank_release"%ROWTYPE;
BEGIN
  SELECT * INTO source_item FROM "question_bank_item" WHERE "id" = NEW."source_question_bank_item_id";
  SELECT * INTO source_release FROM "question_bank_release" WHERE "id" = source_item."question_bank_release_id";
  IF source_item."question_id" IS DISTINCT FROM NEW."source_question_id"
     OR source_item."bank"::text IS DISTINCT FROM NEW."source_bank"
     OR source_item."purpose"::text IS DISTINCT FROM NEW."purpose"
     OR source_release."bank_version" IS DISTINCT FROM NEW."source_bank_version"
     OR (NEW."selection_mode" = 'verbatim' AND source_item."question_text" IS DISTINCT FROM NEW."question_text") THEN
    RAISE EXCEPTION 'QUESTION_CANDIDATE_SOURCE_PROVENANCE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER "question_candidate_source_deferred"
AFTER INSERT OR UPDATE ON "question_candidate"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION verify_question_candidate_source();

CREATE FUNCTION verify_question_snapshot_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate "question_candidate"%ROWTYPE;
BEGIN
  IF NEW."question_candidate_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO candidate FROM "question_candidate" WHERE "id" = NEW."question_candidate_id";
  IF candidate."source_question_id" IS DISTINCT FROM NEW."source_question_id"
     OR candidate."source_bank_version" IS DISTINCT FROM NEW."source_bank_version"
     OR candidate."source_bank" IS DISTINCT FROM NEW."source_bank"
     OR candidate."selection_mode" IS DISTINCT FROM NEW."selection_mode"
     OR candidate."adaptation_reason_code" IS DISTINCT FROM NEW."adaptation_reason_code"
     OR candidate."purpose" IS DISTINCT FROM NEW."purpose"
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
