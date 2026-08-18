BEGIN;

-- Keep the legacy enum and stored values, but let P1 Episode/Fact rows omit the
-- optional metadata tag. Legacy rows still require their historical type.
ALTER TABLE "memory_claim"
  ALTER COLUMN "memory_type" DROP NOT NULL,
  ADD CONSTRAINT "memory_claim_memory_type_identity_check" CHECK (
    "semantic_kind" IS NOT NULL OR "memory_type" IS NOT NULL
  );

ALTER TABLE "memory_resolution"
  ALTER COLUMN "memory_type" DROP NOT NULL,
  ADD CONSTRAINT "memory_resolution_memory_type_identity_check" CHECK (
    "semantic_kind" IS NOT NULL OR "memory_type" IS NOT NULL
  );

-- The old global indexes made an optional tag part of every P1 slot. Split
-- legacy and P1 identities into mutually exclusive partial indexes instead.
DROP INDEX "memory_resolution_project_id_memory_type_canonical_key_reso_key";
DROP INDEX "memory_resolution_one_current_slot_key";

CREATE UNIQUE INDEX "memory_resolution_legacy_slot_revision_key"
  ON "memory_resolution"("project_id", "memory_type", "canonical_key", "resolution_revision")
  WHERE "semantic_kind" IS NULL;

CREATE UNIQUE INDEX "memory_resolution_p1_slot_revision_key"
  ON "memory_resolution"("project_id", "semantic_kind", "canonical_key", "resolution_revision")
  WHERE "semantic_kind" IS NOT NULL;

CREATE UNIQUE INDEX "memory_resolution_legacy_current_slot_key"
  ON "memory_resolution"("project_id", "memory_type", "canonical_key")
  WHERE "semantic_kind" IS NULL AND "status" = 'current'::"MemoryResolutionStatus";

CREATE UNIQUE INDEX "memory_resolution_p1_current_slot_key"
  ON "memory_resolution"("project_id", "semantic_kind", "canonical_key")
  WHERE "semantic_kind" IS NOT NULL AND "status" = 'current'::"MemoryResolutionStatus";

-- v1.1 rows remain valid history while v1.2 becomes the active producer.
ALTER TABLE "ai_job"
  DROP CONSTRAINT "ai_job_maintainer_trigger_namespace",
  ADD CONSTRAINT "ai_job_maintainer_trigger_namespace" CHECK (
    (
      "job_type" = 'working_memory_maintain'::"AiJobType"
      AND "trigger_dedupe_key" IS NOT NULL
      AND (
        "trigger_dedupe_key" LIKE 'memory-p1-v1.1:%'
        OR "trigger_dedupe_key" LIKE 'memory-p1-v1.2:%'
      )
    ) OR (
      "job_type" <> 'working_memory_maintain'::"AiJobType"
      AND (
        "trigger_dedupe_key" IS NULL
        OR (
          "trigger_dedupe_key" NOT LIKE 'memory-p1-v1.1:%'
          AND "trigger_dedupe_key" NOT LIKE 'memory-p1-v1.2:%'
        )
      )
    )
  );

ALTER TABLE "memory_working_snapshot"
  DROP CONSTRAINT "memory_working_snapshot_contract_version_check",
  ADD CONSTRAINT "memory_working_snapshot_contract_version_check" CHECK (
    "contract_version" IN ('memory-maintainer-v1.1', 'memory-maintainer-v1.2')
  );

COMMIT;
