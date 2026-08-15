CREATE TABLE "ai_model_config_manifest" (
  "id" UUID NOT NULL,
  "schema_version" VARCHAR(80) NOT NULL,
  "canonicalization_version" VARCHAR(80) NOT NULL,
  "model_config_version" VARCHAR(80) NOT NULL,
  "model_config_digest" CHAR(64) NOT NULL,
  "manifest_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_model_config_manifest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_model_config_manifest_version_key" UNIQUE ("model_config_version"),
  CONSTRAINT "ai_model_config_manifest_digest_key" UNIQUE ("model_config_digest"),
  CONSTRAINT "ai_model_config_manifest_digest_format" CHECK (
    "model_config_digest" ~ '^[0-9a-f]{64}$'
  )
);

ALTER TABLE "ai_job"
  ADD COLUMN "requested_provider_id" VARCHAR(80),
  ADD COLUMN "requested_provider_model_id" VARCHAR(160);

ALTER TABLE "ai_provider_call"
  ADD COLUMN "provenance_status" VARCHAR(24) NOT NULL DEFAULT 'incomplete',
  ADD COLUMN "evaluation_status" VARCHAR(24) NOT NULL DEFAULT 'unjudged',
  ADD COLUMN "model_config_manifest_id" UUID,
  ADD COLUMN "requested_provider_id" VARCHAR(80),
  ADD COLUMN "requested_provider_model_id" VARCHAR(160),
  ADD COLUMN "observed_response_model_id" VARCHAR(160),
  ADD COLUMN "observed_response_model_id_source" VARCHAR(24),
  ADD COLUMN "model_config_version" VARCHAR(80),
  ADD COLUMN "model_config_digest" CHAR(64),
  ADD COLUMN "prompt_bundle_version" VARCHAR(80),
  ADD COLUMN "prompt_bundle_digest" CHAR(64),
  ADD COLUMN "context_schema_version" VARCHAR(80),
  ADD COLUMN "context_schema_digest" CHAR(64),
  ADD COLUMN "output_schema_version" VARCHAR(80),
  ADD COLUMN "output_schema_digest" CHAR(64),
  ADD COLUMN "deadline_at" TIMESTAMPTZ(3),
  ADD COLUMN "sdk_core_package" VARCHAR(120),
  ADD COLUMN "sdk_core_version" VARCHAR(40),
  ADD COLUMN "sdk_provider_package" VARCHAR(120),
  ADD COLUMN "sdk_provider_package_version" VARCHAR(40),
  ADD COLUMN "connection_mode" VARCHAR(24),
  ADD COLUMN "endpoint_origin" VARCHAR(500),
  ADD COLUMN "data_region" VARCHAR(80),
  ADD COLUMN "provider_request_id_source" VARCHAR(24),
  ADD COLUMN "sdk_response_id" VARCHAR(160),
  ADD COLUMN "sdk_response_id_source" VARCHAR(24),
  ADD COLUMN "config_application_status" VARCHAR(24),
  ADD COLUMN "warnings_json" JSONB;

ALTER TABLE "ai_provider_call"
  ADD CONSTRAINT "ai_provider_call_provenance_status_check"
    CHECK ("provenance_status" IN ('complete', 'incomplete')),
  ADD CONSTRAINT "ai_provider_call_evaluation_status_check"
    CHECK ("evaluation_status" IN ('judged', 'unjudged')),
  ADD CONSTRAINT "ai_provider_call_model_config_digest_format"
    CHECK ("model_config_digest" IS NULL OR "model_config_digest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ai_provider_call_manifest_fk"
    FOREIGN KEY ("model_config_manifest_id") REFERENCES "ai_model_config_manifest"("id") ON DELETE RESTRICT;

CREATE INDEX "ai_provider_call_requested_binding_idx"
  ON "ai_provider_call"("requested_provider_id", "requested_provider_model_id");

COMMENT ON COLUMN "ai_provider_call"."provenance_status" IS
  'Legacy/local-test rows remain incomplete; only schema-validated full provider receipts may be complete.';
COMMENT ON COLUMN "ai_provider_call"."evaluation_status" IS
  'Legacy/local-test rows remain unjudged and cannot establish provider or equal-effective-config PASS.';
