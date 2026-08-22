-- T9-T10 / P3R-02-SUBSTRATE
-- Derived retrieval storage only. Semantic values, status and retention authority
-- remain owned by the existing MemoryClaim/MemoryResolution/P2 rows.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- Composite references let PostgreSQL enforce that the project scope copied into
-- a derived row is the same scope as its stable identity/revision parent.
CREATE UNIQUE INDEX "memory_layer_identity_id_project_key"
  ON "memory_layer_identity" ("id", "project_id");
CREATE UNIQUE INDEX "memory_layer_revision_id_project_identity_key"
  ON "memory_layer_revision" ("id", "project_id", "identity_id");

CREATE TABLE "memory_embedding" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "layer_identity_id" UUID NOT NULL,
  "layer_revision_id" UUID NOT NULL,
  "embedding_profile" VARCHAR(120) NOT NULL,
  "embedding_version" VARCHAR(120) NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "input_digest" CHAR(64) NOT NULL,
  "vector" vector NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_embedding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_embedding_identity_revision_key"
    UNIQUE ("project_id", "layer_identity_id", "layer_revision_id", "embedding_profile", "embedding_version"),
  CONSTRAINT "memory_embedding_dimensions_ck" CHECK ("dimensions" > 0),
  CONSTRAINT "memory_embedding_vector_dimensions_ck" CHECK (vector_dims("vector") = "dimensions"),
  CONSTRAINT "memory_embedding_profile_ck" CHECK (length(btrim("embedding_profile")) > 0),
  CONSTRAINT "memory_embedding_version_ck" CHECK (length(btrim("embedding_version")) > 0),
  CONSTRAINT "memory_embedding_digest_ck" CHECK ("input_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "memory_graph_relation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "source_memory_id" UUID NOT NULL,
  "target_memory_id" UUID NOT NULL,
  "relation_type" VARCHAR(24) NOT NULL,
  "provenance_digest" CHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_graph_relation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_graph_relation_direction_key"
    UNIQUE ("project_id", "source_memory_id", "target_memory_id", "relation_type"),
  CONSTRAINT "memory_graph_relation_type_ck"
    CHECK ("relation_type" IN ('CONTINUATION', 'RESUME', 'BRANCH', 'RELATED')),
  CONSTRAINT "memory_graph_relation_no_self_edge_ck"
    CHECK ("source_memory_id" <> "target_memory_id"),
  CONSTRAINT "memory_graph_relation_related_direction_ck"
    CHECK ("relation_type" <> 'RELATED' OR "source_memory_id" < "target_memory_id"),
  CONSTRAINT "memory_graph_relation_provenance_ck"
    CHECK ("provenance_digest" IS NULL OR "provenance_digest" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "memory_embedding"
  ADD CONSTRAINT "memory_embedding_identity_fk"
    FOREIGN KEY ("layer_identity_id", "project_id")
    REFERENCES "memory_layer_identity" ("id", "project_id")
    ON DELETE CASCADE;
ALTER TABLE "memory_embedding"
  ADD CONSTRAINT "memory_embedding_revision_fk"
    FOREIGN KEY ("layer_revision_id", "project_id", "layer_identity_id")
    REFERENCES "memory_layer_revision" ("id", "project_id", "identity_id")
    ON DELETE CASCADE;

ALTER TABLE "memory_graph_relation"
  ADD CONSTRAINT "memory_graph_relation_source_fk"
    FOREIGN KEY ("source_memory_id", "project_id")
    REFERENCES "memory_layer_identity" ("id", "project_id")
    ON DELETE CASCADE;
ALTER TABLE "memory_graph_relation"
  ADD CONSTRAINT "memory_graph_relation_target_fk"
    FOREIGN KEY ("target_memory_id", "project_id")
    REFERENCES "memory_layer_identity" ("id", "project_id")
    ON DELETE CASCADE;

CREATE INDEX "memory_embedding_project_identity_idx"
  ON "memory_embedding" ("project_id", "layer_identity_id");
CREATE INDEX "memory_embedding_project_revision_idx"
  ON "memory_embedding" ("project_id", "layer_revision_id");
CREATE INDEX "memory_graph_relation_source_idx"
  ON "memory_graph_relation" ("project_id", "source_memory_id", "relation_type");
CREATE INDEX "memory_graph_relation_target_idx"
  ON "memory_graph_relation" ("project_id", "target_memory_id", "relation_type");

COMMIT;
