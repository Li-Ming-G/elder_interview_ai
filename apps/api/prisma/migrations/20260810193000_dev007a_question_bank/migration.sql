-- DEV-007A owns only versioned question-bank facts. Question generation,
-- candidate publication and display history remain owned by QuestionEvidenceModule.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "QuestionBankReleaseStatus" AS ENUM ('draft', 'active', 'retired');
CREATE TYPE "QuestionBankEnvironmentScope" AS ENUM ('product', 'internal_demo');
CREATE TYPE "QuestionBankKind" AS ENUM ('basic', 'deep');
CREATE TYPE "QuestionPurpose" AS ENUM (
  'detail',
  'cause',
  'person',
  'scene',
  'emotion',
  'choice',
  'conflict',
  'turning_point',
  'clarify',
  'timeline',
  'transition'
);
CREATE TYPE "QuestionSensitivity" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "QuestionSourceType" AS ENUM (
  'project_original',
  'licensed_external',
  'public_domain',
  'synthetic_fixture'
);
CREATE TYPE "QuestionLicenseStatus" AS ENUM (
  'project_original',
  'verified',
  'unverified',
  'fixture_only'
);

CREATE TABLE "question_bank_release" (
  "id" uuid NOT NULL,
  "bank_version" varchar(80) NOT NULL,
  "content_digest" char(64) NOT NULL,
  "item_count" integer NOT NULL,
  "membership_sealed_at" timestamptz(3),
  "status" "QuestionBankReleaseStatus" NOT NULL DEFAULT 'draft',
  "source_file_digest" char(64) NOT NULL,
  "validator_version" varchar(80) NOT NULL,
  "environment_scope" "QuestionBankEnvironmentScope" NOT NULL,
  "imported_by" varchar(200) NOT NULL,
  "imported_at" timestamptz(3) NOT NULL,
  "activated_by" varchar(200),
  "activated_at" timestamptz(3),
  "retired_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "question_bank_release_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "question_bank_release_content_digest_check"
    CHECK ("content_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "question_bank_release_source_file_digest_check"
    CHECK ("source_file_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "question_bank_release_item_count_check" CHECK ("item_count" > 0),
  CONSTRAINT "question_bank_release_lifecycle_check" CHECK (
    ("status" = 'draft' AND "activated_by" IS NULL AND "activated_at" IS NULL AND "retired_at" IS NULL)
    OR
    ("status" = 'active' AND "activated_by" IS NOT NULL AND "activated_at" IS NOT NULL AND "retired_at" IS NULL)
    OR
    ("status" = 'retired' AND "activated_by" IS NOT NULL AND "activated_at" IS NOT NULL AND "retired_at" IS NOT NULL)
  )
);

CREATE TABLE "question_bank_item" (
  "id" uuid NOT NULL,
  "question_bank_release_id" uuid NOT NULL,
  "question_id" varchar(120) NOT NULL,
  "bank" "QuestionBankKind" NOT NULL,
  "topic" varchar(120) NOT NULL,
  "question_text" text NOT NULL,
  "purpose" "QuestionPurpose" NOT NULL,
  "applicable_condition_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "inapplicable_condition_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "sensitivity" "QuestionSensitivity" NOT NULL,
  "source_type" "QuestionSourceType" NOT NULL,
  "source_reference" varchar(500) NOT NULL,
  "license_status" "QuestionLicenseStatus" NOT NULL,
  "license_reference" varchar(500) NOT NULL,
  "enabled" boolean NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "question_bank_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "question_bank_item_question_id_not_blank" CHECK (btrim("question_id") <> ''),
  CONSTRAINT "question_bank_item_topic_not_blank" CHECK (btrim("topic") <> ''),
  CONSTRAINT "question_bank_item_question_text_not_blank" CHECK (btrim("question_text") <> ''),
  CONSTRAINT "question_bank_item_source_reference_not_blank" CHECK (btrim("source_reference") <> ''),
  CONSTRAINT "question_bank_item_license_reference_not_blank" CHECK (btrim("license_reference") <> ''),
  CONSTRAINT "question_bank_item_condition_disjoint_check"
    CHECK (NOT ("applicable_condition_codes" && "inapplicable_condition_codes")),
  CONSTRAINT "question_bank_item_source_license_check" CHECK (
    ("source_type" = 'project_original' AND "license_status" = 'project_original')
    OR
    ("source_type" IN ('licensed_external', 'public_domain') AND "license_status" IN ('verified', 'unverified'))
    OR
    ("source_type" = 'synthetic_fixture' AND "license_status" = 'fixture_only')
  ),
  CONSTRAINT "question_bank_item_release_fkey"
    FOREIGN KEY ("question_bank_release_id") REFERENCES "question_bank_release"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "question_bank_release_bank_version_key"
  ON "question_bank_release"("bank_version");
CREATE UNIQUE INDEX "question_bank_release_one_active_per_scope_key"
  ON "question_bank_release"("environment_scope") WHERE "status" = 'active';
CREATE INDEX "question_bank_release_environment_scope_status_idx"
  ON "question_bank_release"("environment_scope", "status");
CREATE UNIQUE INDEX "question_bank_item_release_question_id_key"
  ON "question_bank_item"("question_bank_release_id", "question_id");
CREATE INDEX "question_bank_item_release_bank_enabled_idx"
  ON "question_bank_item"("question_bank_release_id", "bank", "enabled");

-- A request id is globally single-use across controlled question-bank writes.
CREATE UNIQUE INDEX "question_bank_operation_request_id_key"
  ON "audit_log"("request_id")
  WHERE "request_id" IS NOT NULL
    AND "entity_type" = 'question_bank_release'
    AND "action" IN ('question_bank.import_draft', 'question_bank.activate', 'question_bank.retire');

CREATE FUNCTION question_bank_manifest_part(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT octet_length(convert_to(value, 'UTF8'))::text || ':' || value
$$;

CREATE FUNCTION calculate_question_bank_release_content_digest(release_id uuid) RETURNS text
LANGUAGE sql STABLE STRICT AS $$
  SELECT encode(
    digest(
      convert_to(
        question_bank_manifest_part(release_row."validator_version")
        || question_bank_manifest_part(release_row."bank_version")
        || question_bank_manifest_part(release_row."item_count"::text)
        || COALESCE((
          SELECT string_agg(
            question_bank_manifest_part(item."question_id")
            || question_bank_manifest_part(item."bank"::text)
            || question_bank_manifest_part(item."topic")
            || question_bank_manifest_part(item."question_text")
            || question_bank_manifest_part(item."purpose"::text)
            || question_bank_manifest_part(array_to_string(item."applicable_condition_codes", ';'))
            || question_bank_manifest_part(array_to_string(item."inapplicable_condition_codes", ';'))
            || question_bank_manifest_part(item."sensitivity"::text)
            || question_bank_manifest_part(item."source_type"::text)
            || question_bank_manifest_part(item."source_reference")
            || question_bank_manifest_part(item."license_status"::text)
            || question_bank_manifest_part(item."license_reference")
            || question_bank_manifest_part(CASE WHEN item."enabled" THEN 'true' ELSE 'false' END),
            '' ORDER BY item."question_id" COLLATE "C"
          )
          FROM "question_bank_item" item
          WHERE item."question_bank_release_id" = release_row."id"
        ), ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  FROM "question_bank_release" release_row
  WHERE release_row."id" = release_id
$$;

CREATE FUNCTION enforce_question_bank_release_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'draft' OR NEW."membership_sealed_at" IS NOT NULL THEN
    RAISE EXCEPTION 'QUESTION_BANK_RELEASE_CREATION_WINDOW_INVALID';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "question_bank_release_insert_window"
BEFORE INSERT ON "question_bank_release"
FOR EACH ROW EXECUTE FUNCTION enforce_question_bank_release_insert();

CREATE FUNCTION prevent_question_bank_item_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status "QuestionBankReleaseStatus";
  parent_scope "QuestionBankEnvironmentScope";
  parent_sealed_at timestamptz(3);
  expected_count integer;
  current_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "status", "environment_scope", "membership_sealed_at", "item_count"
    INTO parent_status, parent_scope, parent_sealed_at, expected_count
    FROM "question_bank_release"
    WHERE "id" = NEW."question_bank_release_id"
    FOR UPDATE;

    IF parent_status IS NULL
       OR parent_status <> 'draft'
       OR parent_sealed_at IS NOT NULL THEN
      RAISE EXCEPTION 'QUESTION_BANK_RELEASE_MEMBERSHIP_SEALED';
    END IF;
    IF (parent_scope = 'internal_demo' AND NOT (
          NEW."source_type" = 'synthetic_fixture' AND NEW."license_status" = 'fixture_only'
        )) OR (parent_scope = 'product' AND (
          NEW."source_type" = 'synthetic_fixture' OR NEW."license_status" = 'fixture_only'
        )) THEN
      RAISE EXCEPTION 'QUESTION_BANK_RELEASE_SCOPE_LICENSE_MISMATCH';
    END IF;

    SELECT count(*) INTO current_count
    FROM "question_bank_item"
    WHERE "question_bank_release_id" = NEW."question_bank_release_id";
    IF current_count >= expected_count THEN
      RAISE EXCEPTION 'QUESTION_BANK_RELEASE_ITEM_COUNT_EXCEEDED';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'QUESTION_BANK_ITEM_IMMUTABLE';
END $$;

CREATE TRIGGER "question_bank_item_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "question_bank_item"
FOR EACH ROW EXECUTE FUNCTION prevent_question_bank_item_mutation();

CREATE FUNCTION enforce_question_bank_release_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item_count integer;
  basic_count integer;
  deep_count integer;
  invalid_license_count integer;
  actual_digest text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUESTION_BANK_RELEASE_IMMUTABLE';
  END IF;

  IF NEW."bank_version" IS DISTINCT FROM OLD."bank_version"
     OR NEW."content_digest" IS DISTINCT FROM OLD."content_digest"
     OR NEW."item_count" IS DISTINCT FROM OLD."item_count"
     OR NEW."source_file_digest" IS DISTINCT FROM OLD."source_file_digest"
     OR NEW."validator_version" IS DISTINCT FROM OLD."validator_version"
     OR NEW."environment_scope" IS DISTINCT FROM OLD."environment_scope"
     OR NEW."imported_by" IS DISTINCT FROM OLD."imported_by"
     OR NEW."imported_at" IS DISTINCT FROM OLD."imported_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'QUESTION_BANK_RELEASE_CONTENT_IMMUTABLE';
  END IF;

  IF OLD."status" = NEW."status" THEN
    IF OLD."status" = 'draft'
       AND OLD."membership_sealed_at" IS NULL
       AND NEW."membership_sealed_at" IS NOT NULL
       AND NEW."activated_by" IS NOT DISTINCT FROM OLD."activated_by"
       AND NEW."activated_at" IS NOT DISTINCT FROM OLD."activated_at"
       AND NEW."retired_at" IS NOT DISTINCT FROM OLD."retired_at" THEN
      SELECT count(*) INTO item_count
      FROM "question_bank_item"
      WHERE "question_bank_release_id" = NEW."id";
      actual_digest := calculate_question_bank_release_content_digest(NEW."id");
      IF item_count <> NEW."item_count" OR actual_digest <> NEW."content_digest" THEN
        RAISE EXCEPTION 'QUESTION_BANK_RELEASE_MEMBERSHIP_MISMATCH';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'QUESTION_BANK_RELEASE_MUTATION_NOT_ALLOWED';
  END IF;
  IF OLD."membership_sealed_at" IS NULL
     OR NEW."membership_sealed_at" IS DISTINCT FROM OLD."membership_sealed_at" THEN
    RAISE EXCEPTION 'QUESTION_BANK_RELEASE_MEMBERSHIP_UNSEALED';
  END IF;
  IF NOT (
    (OLD."status" = 'draft' AND NEW."status" = 'active')
    OR (OLD."status" = 'active' AND NEW."status" = 'retired')
  ) THEN
    RAISE EXCEPTION 'QUESTION_BANK_RELEASE_INVALID_TRANSITION';
  END IF;

  IF NEW."status" = 'active' THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE "bank" = 'basic'),
      count(*) FILTER (WHERE "bank" = 'deep'),
      count(*) FILTER (
        WHERE
          (NEW."environment_scope" = 'product' AND "license_status" NOT IN ('project_original', 'verified'))
          OR
          (NEW."environment_scope" = 'internal_demo' AND NOT (
            "source_type" = 'synthetic_fixture' AND "license_status" = 'fixture_only'
          ))
      )
    INTO item_count, basic_count, deep_count, invalid_license_count
    FROM "question_bank_item"
    WHERE "question_bank_release_id" = NEW."id";

    IF item_count = 0 OR basic_count = 0 OR deep_count = 0 THEN
      RAISE EXCEPTION 'QUESTION_BANK_RELEASE_INCOMPLETE';
    END IF;
    actual_digest := calculate_question_bank_release_content_digest(NEW."id");
    IF item_count <> NEW."item_count" OR actual_digest <> NEW."content_digest" THEN
      RAISE EXCEPTION 'QUESTION_BANK_RELEASE_MEMBERSHIP_MISMATCH';
    END IF;
    IF invalid_license_count <> 0 THEN
      RAISE EXCEPTION 'QUESTION_BANK_RELEASE_LICENSE_BLOCKED';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "question_bank_release_lifecycle"
BEFORE UPDATE OR DELETE ON "question_bank_release"
FOR EACH ROW EXECUTE FUNCTION enforce_question_bank_release_lifecycle();

CREATE FUNCTION enforce_question_bank_release_commit_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_release record;
  actual_count integer;
  actual_digest text;
BEGIN
  SELECT "membership_sealed_at", "item_count", "content_digest"
  INTO current_release
  FROM "question_bank_release"
  WHERE "id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO actual_count
  FROM "question_bank_item"
  WHERE "question_bank_release_id" = NEW."id";
  actual_digest := calculate_question_bank_release_content_digest(NEW."id");
  IF current_release."membership_sealed_at" IS NULL
     OR actual_count <> current_release."item_count"
     OR actual_digest <> current_release."content_digest" THEN
    RAISE EXCEPTION 'QUESTION_BANK_RELEASE_COMMIT_INTEGRITY_FAILED';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "question_bank_release_commit_integrity"
AFTER INSERT OR UPDATE ON "question_bank_release"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_question_bank_release_commit_integrity();
