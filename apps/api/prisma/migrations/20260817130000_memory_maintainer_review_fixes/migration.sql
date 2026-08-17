BEGIN;

CREATE TYPE "MemoryProvenanceState" AS ENUM (
  'active',
  'detached_session',
  'detached_thread',
  'detached_session_thread'
);

ALTER TABLE "memory_claim"
  ADD COLUMN "provenance_state" "MemoryProvenanceState";

ALTER TABLE "memory_resolution"
  ADD COLUMN "provenance_state" "MemoryProvenanceState";

UPDATE "memory_claim"
SET "provenance_state" = 'active'
WHERE "semantic_kind" IS NOT NULL;

UPDATE "memory_resolution"
SET "provenance_state" = 'active'
WHERE "semantic_kind" IS NOT NULL;

ALTER TABLE "memory_claim"
  DROP CONSTRAINT IF EXISTS "memory_claim_v1_1_authority_all_or_none",
  ADD CONSTRAINT "memory_claim_v1_1_provenance_lifecycle" CHECK (
    (
      "semantic_kind" IS NULL AND "layer" IS NULL AND "provenance_state" IS NULL
      AND "source_session_id" IS NULL AND "thread_id" IS NULL
    )
    OR
    (
      "semantic_kind" IS NOT NULL AND "layer" IS NOT NULL
      AND (
        ("provenance_state" = 'active' AND "source_session_id" IS NOT NULL AND "thread_id" IS NOT NULL)
        OR ("provenance_state" = 'detached_session' AND "source_session_id" IS NULL AND "thread_id" IS NOT NULL)
        OR ("provenance_state" = 'detached_thread' AND "source_session_id" IS NOT NULL AND "thread_id" IS NULL)
        OR ("provenance_state" = 'detached_session_thread' AND "source_session_id" IS NULL AND "thread_id" IS NULL)
      )
    )
  );

ALTER TABLE "memory_resolution"
  DROP CONSTRAINT IF EXISTS "memory_resolution_v1_1_authority_all_or_none",
  ADD CONSTRAINT "memory_resolution_v1_1_provenance_lifecycle" CHECK (
    (
      "semantic_kind" IS NULL AND "layer" IS NULL AND "semantic_status" IS NULL
      AND "provenance_state" IS NULL AND "source_session_id" IS NULL AND "thread_id" IS NULL
    )
    OR
    (
      "semantic_kind" IS NOT NULL AND "layer" IS NOT NULL AND "semantic_status" IS NOT NULL
      AND (
        ("provenance_state" = 'active' AND "source_session_id" IS NOT NULL AND "thread_id" IS NOT NULL)
        OR ("provenance_state" = 'detached_session' AND "source_session_id" IS NULL AND "thread_id" IS NOT NULL)
        OR ("provenance_state" = 'detached_thread' AND "source_session_id" IS NOT NULL AND "thread_id" IS NULL)
        OR ("provenance_state" = 'detached_session_thread' AND "source_session_id" IS NULL AND "thread_id" IS NULL)
      )
    )
  );

CREATE FUNCTION "memory_detach_session_provenance"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "memory_claim"
  SET
    "source_session_id" = NULL,
    "provenance_state" = CASE
      WHEN "thread_id" IS NULL THEN 'detached_session_thread'::"MemoryProvenanceState"
      ELSE 'detached_session'::"MemoryProvenanceState"
    END
  WHERE "source_session_id" = OLD."id" AND "provenance_state" IS NOT NULL;

  UPDATE "memory_resolution"
  SET
    "source_session_id" = NULL,
    "provenance_state" = CASE
      WHEN "thread_id" IS NULL THEN 'detached_session_thread'::"MemoryProvenanceState"
      ELSE 'detached_session'::"MemoryProvenanceState"
    END
  WHERE "source_session_id" = OLD."id" AND "provenance_state" IS NOT NULL;

  RETURN OLD;
END;
$$;

CREATE TRIGGER "interview_session_memory_provenance_detach"
BEFORE DELETE ON "interview_session"
FOR EACH ROW EXECUTE FUNCTION "memory_detach_session_provenance"();

CREATE FUNCTION "memory_detach_thread_provenance"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "memory_claim"
  SET
    "thread_id" = NULL,
    "provenance_state" = CASE
      WHEN "source_session_id" IS NULL THEN 'detached_session_thread'::"MemoryProvenanceState"
      ELSE 'detached_thread'::"MemoryProvenanceState"
    END
  WHERE "thread_id" = OLD."id" AND "provenance_state" IS NOT NULL;

  UPDATE "memory_resolution"
  SET
    "thread_id" = NULL,
    "provenance_state" = CASE
      WHEN "source_session_id" IS NULL THEN 'detached_session_thread'::"MemoryProvenanceState"
      ELSE 'detached_thread'::"MemoryProvenanceState"
    END
  WHERE "thread_id" = OLD."id" AND "provenance_state" IS NOT NULL;

  RETURN OLD;
END;
$$;

CREATE TRIGGER "memory_thread_value_provenance_detach"
BEFORE DELETE ON "memory_thread"
FOR EACH ROW EXECUTE FUNCTION "memory_detach_thread_provenance"();

COMMIT;
