-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'ready', 'active', 'completed', 'restricted', 'deleted');
CREATE TYPE "AssignmentRole" AS ENUM ('interviewer');
CREATE TYPE "ConsentType" AS ENUM ('recording_transcription_ai');
CREATE TYPE "ConsentMethod" AS ENUM ('recorded_verbal', 'electronic', 'written');
CREATE TYPE "ConsentStatus" AS ENUM ('pending', 'valid', 'revoked', 'expired');
CREATE TYPE "InterviewSessionStatus" AS ENUM ('created', 'device_check', 'recording', 'reconnecting', 'stopping', 'processing', 'completed', 'interrupted', 'failed');

-- CreateTable
CREATE TABLE "elder_project" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(120),
    "birth_year" INTEGER,
    "approximate_age" INTEGER,
    "native_place" VARCHAR(200),
    "current_city" VARCHAR(200),
    "status" "ProjectStatus" NOT NULL DEFAULT 'draft',
    "status_before_restriction" "ProjectStatus",
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "elder_project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_assignment" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assignment_role" "AssignmentRole" NOT NULL DEFAULT 'interviewer',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "project_assignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_term" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "included_minutes" INTEGER NOT NULL,
    "estimated_session_count" INTEGER NOT NULL,
    "expected_current_minutes" INTEGER NOT NULL,
    "overtime_unit_minutes" INTEGER NOT NULL,
    "overtime_price_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "explained_at" TIMESTAMPTZ(3) NOT NULL,
    "explained_by" UUID NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "superseded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_term_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_term_nonnegative" CHECK ("included_minutes" >= 0 AND "estimated_session_count" >= 0 AND "expected_current_minutes" >= 0 AND "overtime_unit_minutes" >= 0 AND "overtime_price_minor" >= 0),
    CONSTRAINT "service_term_currency" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "consent_record" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "consent_type" "ConsentType" NOT NULL DEFAULT 'recording_transcription_ai',
    "consent_text_version" VARCHAR(80) NOT NULL,
    "consent_method" "ConsentMethod" NOT NULL,
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_audio_object_id" UUID,
    "status" "ConsentStatus" NOT NULL DEFAULT 'valid',
    "revoked_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consent_audio_method" CHECK (("consent_method" = 'recorded_verbal' AND "consent_audio_object_id" IS NOT NULL) OR ("consent_method" IN ('electronic', 'written') AND "consent_audio_object_id" IS NULL))
);

CREATE TABLE "interview_session" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "status" "InterviewSessionStatus" NOT NULL DEFAULT 'created',
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "duration_seconds" INTEGER,
    "asr_provider" VARCHAR(100),
    "llm_provider" VARCHAR(100),
    "prompt_version" VARCHAR(100),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "interview_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "idempotency_record" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "actor_id" UUID NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" UUID NOT NULL,
    "response_payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "elder_project_status_updated_at_idx" ON "elder_project"("status", "updated_at" DESC);
CREATE INDEX "project_assignment_user_id_revoked_at_idx" ON "project_assignment"("user_id", "revoked_at");
CREATE UNIQUE INDEX "project_assignment_active_key" ON "project_assignment"("project_id", "user_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "service_term_project_id_effective_from_idx" ON "service_term"("project_id", "effective_from" DESC);
CREATE UNIQUE INDEX "service_term_current_key" ON "service_term"("project_id") WHERE "superseded_at" IS NULL;
CREATE INDEX "consent_record_project_id_consent_type_created_at_idx" ON "consent_record"("project_id", "consent_type", "created_at" DESC);
CREATE UNIQUE INDEX "interview_session_project_id_sequence_no_key" ON "interview_session"("project_id", "sequence_no");
CREATE UNIQUE INDEX "idempotency_record_request_id_key" ON "idempotency_record"("request_id");

ALTER TABLE "elder_project" ADD CONSTRAINT "elder_project_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_assignment" ADD CONSTRAINT "project_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_term" ADD CONSTRAINT "service_term_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_term" ADD CONSTRAINT "service_term_explained_by_fkey" FOREIGN KEY ("explained_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
