-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('memory_extract', 'question_generate', 'actual_question_reconcile', 'session_note', 'context_snapshot', 'boundary_detect');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AiDerivedOutputType" AS ENUM ('memory_claim', 'memory_resolution', 'question_candidate', 'boundary_candidate', 'actual_question_catalog', 'session_note', 'context_snapshot');

-- CreateEnum
CREATE TYPE "AiDerivedOutputStatus" AS ENUM ('current', 'invalidated', 'waiting_recompute', 'recompute_failed', 'review_required', 'superseded');

-- CreateEnum
CREATE TYPE "RetentionState" AS ENUM ('active', 'hidden', 'purging', 'cleanup_failed');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('person', 'relationship', 'place', 'event', 'time', 'time_range', 'important_choice', 'reason_clue', 'unfinished_story');

-- CreateEnum
CREATE TYPE "MemoryValueKind" AS ENUM ('exact', 'range', 'unknown');

-- CreateEnum
CREATE TYPE "MemoryAuthority" AS ENUM ('automatic', 'human_confirmed', 'system_migration');

-- CreateEnum
CREATE TYPE "MemoryResolutionKind" AS ENUM ('single', 'range', 'unknown', 'conflict_set', 'review_required');

-- CreateEnum
CREATE TYPE "MemoryResolutionStatus" AS ENUM ('current', 'pending_review', 'superseded');

-- AlterTable
ALTER TABLE "elder_project" ADD COLUMN     "ai_policy_revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ai_retention_policy_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "transcript_segment" ADD COLUMN     "text_revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_job" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "job_type" "AiJobType" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'pending',
    "model_name" VARCHAR(120) NOT NULL,
    "prompt_version" VARCHAR(80) NOT NULL,
    "schema_version" VARCHAR(80) NOT NULL,
    "context_builder_version" VARCHAR(80) NOT NULL,
    "policy_revision" INTEGER NOT NULL,
    "retention_policy_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "retention_state" "RetentionState" NOT NULL DEFAULT 'active',
    "retention_hidden_at" TIMESTAMPTZ(3),
    "retention_cleanup_request_id" UUID,
    "retention_cleanup_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "retention_cleanup_started_at" TIMESTAMPTZ(3),
    "retention_cleanup_error_code" VARCHAR(80),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "failure_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_job_session_scope" (
    "id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "speaker_role_revision" INTEGER NOT NULL,
    "eligible_segment_count" INTEGER NOT NULL,
    "segment_manifest_hash" CHAR(64) NOT NULL,
    "input_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_job_session_scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_job_input_segment" (
    "id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "transcript_segment_id" UUID NOT NULL,
    "text_revision" INTEGER NOT NULL,
    "speaker_role_revision" INTEGER NOT NULL,
    "trusted_effective_role" "SpeakerRole" NOT NULL,
    "role_authority" "SpeakerRoleAuthority" NOT NULL,
    "content_kind" "TranscriptContentKind" NOT NULL,
    "effective_text_digest" CHAR(64) NOT NULL,
    "input_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_job_input_segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_job_input_memory" (
    "id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "memory_resolution_id" UUID NOT NULL,
    "resolution_revision" INTEGER NOT NULL,
    "input_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_job_input_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_call" (
    "id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "call_no" INTEGER NOT NULL,
    "call_kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "provider_request_id" VARCHAR(160),
    "input_hash" CHAR(64) NOT NULL,
    "output_hash" CHAR(64),
    "token_usage_json" JSONB,
    "latency_ms" INTEGER,
    "error_code" VARCHAR(80),
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_provider_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_derived_output" (
    "id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "output_type" "AiDerivedOutputType" NOT NULL,
    "business_output_id" UUID NOT NULL,
    "status" "AiDerivedOutputStatus" NOT NULL DEFAULT 'current',
    "expected_segment_count" INTEGER NOT NULL,
    "expected_segment_manifest_hash" CHAR(64) NOT NULL,
    "expected_memory_count" INTEGER NOT NULL,
    "expected_memory_manifest_hash" CHAR(64) NOT NULL,
    "expected_question_count" INTEGER NOT NULL,
    "expected_question_manifest_hash" CHAR(64) NOT NULL,
    "invalidated_at" TIMESTAMPTZ(3),
    "invalidation_reason" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_derived_output_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_output_segment_dependency" (
    "id" UUID NOT NULL,
    "ai_derived_output_id" UUID NOT NULL,
    "ai_job_input_segment_id" UUID NOT NULL,
    "dependency_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_output_segment_dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_output_memory_dependency" (
    "id" UUID NOT NULL,
    "ai_derived_output_id" UUID NOT NULL,
    "ai_job_input_memory_id" UUID NOT NULL,
    "dependency_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_output_memory_dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_output_question_dependency" (
    "id" UUID NOT NULL,
    "ai_derived_output_id" UUID NOT NULL,
    "target_kind" VARCHAR(32) NOT NULL,
    "target_id" UUID NOT NULL,
    "targetRevision" INTEGER NOT NULL,
    "target_digest" CHAR(64) NOT NULL,
    "dependency_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_output_question_dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_retention_root" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_kind" VARCHAR(32) NOT NULL,
    "source_operation_id" UUID NOT NULL,
    "retention_policy_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "retention_state" "RetentionState" NOT NULL DEFAULT 'active',
    "retention_hidden_at" TIMESTAMPTZ(3),
    "retention_cleanup_request_id" UUID,
    "retention_cleanup_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "retention_cleanup_started_at" TIMESTAMPTZ(3),
    "retention_cleanup_error_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_retention_root_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_claim" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "ai_job_id" UUID,
    "memory_retention_root_id" UUID,
    "ai_derived_output_id" UUID,
    "memory_type" "MemoryType" NOT NULL,
    "canonical_key" VARCHAR(240) NOT NULL,
    "value_kind" "MemoryValueKind" NOT NULL,
    "value_json" JSONB NOT NULL,
    "normalized_value_digest" CHAR(64) NOT NULL,
    "authority" "MemoryAuthority" NOT NULL DEFAULT 'automatic',
    "explicit_correction" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_claim_evidence" (
    "id" UUID NOT NULL,
    "memory_claim_id" UUID NOT NULL,
    "ai_job_input_segment_id" UUID NOT NULL,
    "transcript_segment_id" UUID NOT NULL,
    "evidence_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_claim_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_resolution" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "ai_job_id" UUID,
    "memory_retention_root_id" UUID,
    "ai_derived_output_id" UUID,
    "memory_type" "MemoryType" NOT NULL,
    "canonical_key" VARCHAR(240) NOT NULL,
    "resolution_revision" INTEGER NOT NULL,
    "resolution_kind" "MemoryResolutionKind" NOT NULL,
    "resolved_value_json" JSONB,
    "authority" "MemoryAuthority" NOT NULL,
    "status" "MemoryResolutionStatus" NOT NULL DEFAULT 'current',
    "supersedes_resolution_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_resolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_resolution_member" (
    "id" UUID NOT NULL,
    "memory_resolution_id" UUID NOT NULL,
    "memory_claim_id" UUID NOT NULL,
    "member_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_resolution_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_generation_attempt" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "attempt_kind" VARCHAR(32) NOT NULL,
    "retry_of_attempt_id" UUID,
    "basis_presentation_revision" INTEGER NOT NULL,
    "basis_snapshot_id" UUID,
    "manual_intent_sequence" INTEGER NOT NULL,
    "selection_policy_version" VARCHAR(80) NOT NULL,
    "similarity_policy_version" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "result_kind" VARCHAR(24),
    "publication_outcome" VARCHAR(32),
    "failure_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "question_generation_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_candidate" (
    "id" UUID NOT NULL,
    "question_generation_attempt_id" UUID NOT NULL,
    "ai_derived_output_id" UUID NOT NULL,
    "question_text" TEXT NOT NULL,
    "reason_text" TEXT NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "risk" VARCHAR(24) NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "normalized_question_digest" CHAR(64) NOT NULL,
    "selection_score" DECIMAL(4,3) NOT NULL,
    "selection_policy_version" VARCHAR(80) NOT NULL,
    "similarity_policy_version" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_display_snapshot" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "question_candidate_id" UUID,
    "display_sequence" INTEGER NOT NULL,
    "published_presentation_revision" INTEGER NOT NULL,
    "question_text" TEXT NOT NULL,
    "reason_text" TEXT NOT NULL,
    "normalized_question_digest" CHAR(64) NOT NULL,
    "selection_score" DECIMAL(4,3) NOT NULL,
    "selection_policy_version" VARCHAR(80) NOT NULL,
    "similarity_policy_version" VARCHAR(80) NOT NULL,
    "evidence_manifest_hash" CHAR(64) NOT NULL,
    "memory_manifest_hash" CHAR(64) NOT NULL,
    "role_watermark_hash" CHAR(64) NOT NULL,
    "boundary_policy_revision" INTEGER NOT NULL,
    "model_name" VARCHAR(120) NOT NULL,
    "prompt_version" VARCHAR(80) NOT NULL,
    "schema_version" VARCHAR(80) NOT NULL,
    "context_builder_version" VARCHAR(80) NOT NULL,
    "retention_policy_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "retention_state" "RetentionState" NOT NULL DEFAULT 'active',
    "retention_hidden_at" TIMESTAMPTZ(3),
    "retention_cleanup_request_id" UUID,
    "retention_cleanup_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "retention_cleanup_started_at" TIMESTAMPTZ(3),
    "retention_cleanup_error_code" VARCHAR(80),
    "displayed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_display_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_display_state" (
    "session_id" UUID NOT NULL,
    "current_snapshot_id" UUID,
    "presentation_revision" INTEGER NOT NULL DEFAULT 0,
    "next_display_sequence" INTEGER NOT NULL DEFAULT 1,
    "manual_intent_sequence" INTEGER NOT NULL DEFAULT 0,
    "presentation_kind" VARCHAR(24) NOT NULL,
    "visibility" VARCHAR(16) NOT NULL,
    "withdrawal_reason" VARCHAR(80),
    "policy_revision_checked" INTEGER NOT NULL,
    "last_auto_published_at" TIMESTAMPTZ(3),
    "last_manual_attempt_accepted_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "question_display_state_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "question_evidence_event" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "snapshot_id" UUID,
    "request_id" UUID NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "event_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_id" UUID,
    "retention_owner_kind" VARCHAR(24) NOT NULL,
    "retention_ai_job_id" UUID,
    "retention_display_snapshot_id" UUID,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "question_evidence_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actual_question_analysis" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "ai_derived_output_id" UUID,
    "analysis_revision" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "judgeability" VARCHAR(20) NOT NULL,
    "transcript_status" VARCHAR(24) NOT NULL,
    "semantic_match_version" VARCHAR(80) NOT NULL,
    "replaces_analysis_id" UUID,
    "is_current_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "actual_question_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actual_question" (
    "id" UUID NOT NULL,
    "actual_question_analysis_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "question_text" TEXT NOT NULL,
    "normalized_digest" CHAR(64) NOT NULL,
    "source_kind" VARCHAR(40) NOT NULL,
    "asked_at_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actual_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actual_question_evidence" (
    "id" UUID NOT NULL,
    "actual_question_id" UUID NOT NULL,
    "ai_job_input_segment_id" UUID NOT NULL,
    "transcript_segment_id" UUID NOT NULL,
    "evidence_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actual_question_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestion_outcome" (
    "id" UUID NOT NULL,
    "actual_question_analysis_id" UUID NOT NULL,
    "question_display_snapshot_id" UUID,
    "outcome" VARCHAR(24) NOT NULL,
    "matched_actual_question_id" UUID,
    "semantic_match_version" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestion_outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_context_snapshot" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "consumer_session_id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "ai_derived_output_id" UUID NOT NULL,
    "policy_revision" INTEGER NOT NULL,
    "memory_manifest_hash" CHAR(64) NOT NULL,
    "actual_question_manifest_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_context_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_snapshot_memory" (
    "context_snapshot_id" UUID NOT NULL,
    "memory_resolution_id" UUID NOT NULL,
    "resolution_revision" INTEGER NOT NULL,
    "input_order" INTEGER NOT NULL,

    CONSTRAINT "context_snapshot_memory_pkey" PRIMARY KEY ("context_snapshot_id","memory_resolution_id")
);

-- CreateTable
CREATE TABLE "context_snapshot_actual_question" (
    "context_snapshot_id" UUID NOT NULL,
    "actual_question_id" UUID NOT NULL,
    "input_order" INTEGER NOT NULL,

    CONSTRAINT "context_snapshot_actual_question_pkey" PRIMARY KEY ("context_snapshot_id","actual_question_id")
);

-- CreateTable
CREATE TABLE "ai_retention_cleanup_audit" (
    "id" UUID NOT NULL,
    "cleanup_request_hash" CHAR(64) NOT NULL,
    "root_kind" VARCHAR(32) NOT NULL,
    "root_id_hash" CHAR(64) NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "error_code" VARCHAR(80),
    "attempt_count" INTEGER NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_retention_cleanup_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_job_request_id_key" ON "ai_job"("request_id");

-- CreateIndex
CREATE INDEX "ai_job_project_id_job_type_created_at_idx" ON "ai_job"("project_id", "job_type", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_job_session_scope_ai_job_id_session_id_key" ON "ai_job_session_scope"("ai_job_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_job_session_scope_ai_job_id_input_order_key" ON "ai_job_session_scope"("ai_job_id", "input_order");

-- CreateIndex
CREATE UNIQUE INDEX "ai_job_input_segment_ai_job_id_transcript_segment_id_key" ON "ai_job_input_segment"("ai_job_id", "transcript_segment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_job_input_segment_ai_job_id_input_order_key" ON "ai_job_input_segment"("ai_job_id", "input_order");

-- CreateIndex
CREATE UNIQUE INDEX "ai_job_input_memory_ai_job_id_memory_resolution_id_key" ON "ai_job_input_memory"("ai_job_id", "memory_resolution_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_job_input_memory_ai_job_id_input_order_key" ON "ai_job_input_memory"("ai_job_id", "input_order");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_call_ai_job_id_call_no_key" ON "ai_provider_call"("ai_job_id", "call_no");

-- CreateIndex
CREATE UNIQUE INDEX "ai_derived_output_business_output_id_key" ON "ai_derived_output"("business_output_id");

-- CreateIndex
CREATE INDEX "ai_derived_output_project_id_output_type_status_idx" ON "ai_derived_output"("project_id", "output_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_output_segment_dependency_ai_derived_output_id_ai_job_in_key" ON "ai_output_segment_dependency"("ai_derived_output_id", "ai_job_input_segment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_output_segment_dependency_ai_derived_output_id_dependenc_key" ON "ai_output_segment_dependency"("ai_derived_output_id", "dependency_order");

-- CreateIndex
CREATE UNIQUE INDEX "ai_output_memory_dependency_ai_derived_output_id_ai_job_inp_key" ON "ai_output_memory_dependency"("ai_derived_output_id", "ai_job_input_memory_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_output_memory_dependency_ai_derived_output_id_dependency_key" ON "ai_output_memory_dependency"("ai_derived_output_id", "dependency_order");

-- CreateIndex
CREATE UNIQUE INDEX "ai_output_question_dependency_ai_derived_output_id_target_k_key" ON "ai_output_question_dependency"("ai_derived_output_id", "target_kind", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_output_question_dependency_ai_derived_output_id_dependen_key" ON "ai_output_question_dependency"("ai_derived_output_id", "dependency_order");

-- CreateIndex
CREATE UNIQUE INDEX "memory_retention_root_source_operation_id_key" ON "memory_retention_root"("source_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_claim_ai_derived_output_id_key" ON "memory_claim"("ai_derived_output_id");

-- CreateIndex
CREATE INDEX "memory_claim_project_id_memory_type_canonical_key_idx" ON "memory_claim"("project_id", "memory_type", "canonical_key");

-- CreateIndex
CREATE UNIQUE INDEX "memory_claim_evidence_memory_claim_id_ai_job_input_segment__key" ON "memory_claim_evidence"("memory_claim_id", "ai_job_input_segment_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_claim_evidence_memory_claim_id_evidence_order_key" ON "memory_claim_evidence"("memory_claim_id", "evidence_order");

-- CreateIndex
CREATE UNIQUE INDEX "memory_resolution_ai_derived_output_id_key" ON "memory_resolution"("ai_derived_output_id");

-- CreateIndex
CREATE INDEX "memory_resolution_project_id_status_idx" ON "memory_resolution"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "memory_resolution_project_id_memory_type_canonical_key_reso_key" ON "memory_resolution"("project_id", "memory_type", "canonical_key", "resolution_revision");

-- CreateIndex
CREATE UNIQUE INDEX "memory_resolution_member_memory_resolution_id_memory_claim__key" ON "memory_resolution_member"("memory_resolution_id", "memory_claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_resolution_member_memory_resolution_id_member_order_key" ON "memory_resolution_member"("memory_resolution_id", "member_order");

-- CreateIndex
CREATE UNIQUE INDEX "question_generation_attempt_ai_job_id_key" ON "question_generation_attempt"("ai_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_generation_attempt_request_id_key" ON "question_generation_attempt"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_candidate_question_generation_attempt_id_key" ON "question_candidate"("question_generation_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_candidate_ai_derived_output_id_key" ON "question_candidate"("ai_derived_output_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_display_snapshot_session_id_display_sequence_key" ON "question_display_snapshot"("session_id", "display_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "question_evidence_event_request_id_key" ON "question_evidence_event"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "actual_question_analysis_ai_job_id_key" ON "actual_question_analysis"("ai_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "actual_question_analysis_ai_derived_output_id_key" ON "actual_question_analysis"("ai_derived_output_id");

-- CreateIndex
CREATE INDEX "actual_question_analysis_project_id_is_current_published_idx" ON "actual_question_analysis"("project_id", "is_current_published");

-- CreateIndex
CREATE UNIQUE INDEX "actual_question_analysis_session_id_analysis_revision_key" ON "actual_question_analysis"("session_id", "analysis_revision");

-- CreateIndex
CREATE INDEX "actual_question_actual_question_analysis_id_idx" ON "actual_question"("actual_question_analysis_id");

-- CreateIndex
CREATE UNIQUE INDEX "actual_question_evidence_actual_question_id_ai_job_input_se_key" ON "actual_question_evidence"("actual_question_id", "ai_job_input_segment_id");

-- CreateIndex
CREATE UNIQUE INDEX "actual_question_evidence_actual_question_id_evidence_order_key" ON "actual_question_evidence"("actual_question_id", "evidence_order");

-- CreateIndex
CREATE UNIQUE INDEX "suggestion_outcome_actual_question_analysis_id_question_dis_key" ON "suggestion_outcome"("actual_question_analysis_id", "question_display_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "interview_context_snapshot_ai_job_id_key" ON "interview_context_snapshot"("ai_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "interview_context_snapshot_ai_derived_output_id_key" ON "interview_context_snapshot"("ai_derived_output_id");

-- CreateIndex
CREATE UNIQUE INDEX "context_snapshot_memory_context_snapshot_id_input_order_key" ON "context_snapshot_memory"("context_snapshot_id", "input_order");

-- CreateIndex
CREATE UNIQUE INDEX "context_snapshot_actual_question_context_snapshot_id_input__key" ON "context_snapshot_actual_question"("context_snapshot_id", "input_order");

-- CreateIndex
CREATE UNIQUE INDEX "ai_retention_cleanup_audit_cleanup_request_hash_key" ON "ai_retention_cleanup_audit"("cleanup_request_hash");

-- Reserved business roots are present so the deferred derived-output identity
-- constraint remains exhaustive without implementing their producers in DEV-006.
CREATE TABLE "boundary_candidate" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "ai_derived_output_id" UUID NOT NULL,
    "boundary_kind" VARCHAR(40) NOT NULL,
    "candidate_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "boundary_candidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "boundary_candidate_ai_derived_output_id_key" ON "boundary_candidate"("ai_derived_output_id");

CREATE TABLE "generated_session_note" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "ai_job_id" UUID NOT NULL,
    "ai_derived_output_id" UUID NOT NULL,
    "note_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "generated_session_note_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "generated_session_note_ai_derived_output_id_key" ON "generated_session_note"("ai_derived_output_id");

-- Root ownership and state invariants.
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_retention_attempt_nonnegative" CHECK ("retention_cleanup_attempt_count" >= 0);
ALTER TABLE "ai_job_session_scope" ADD CONSTRAINT "ai_job_scope_count_nonnegative" CHECK ("eligible_segment_count" >= 0);
ALTER TABLE "ai_provider_call" ADD CONSTRAINT "ai_provider_call_no_check" CHECK ("call_no" IN (1, 2));
ALTER TABLE "ai_provider_call" ADD CONSTRAINT "ai_provider_call_kind_check" CHECK ("call_kind" IN ('primary', 'format_repair'));
ALTER TABLE "ai_provider_call" ADD CONSTRAINT "ai_provider_call_status_check" CHECK ("status" IN ('running', 'succeeded', 'failed'));
ALTER TABLE "memory_retention_root" ADD CONSTRAINT "memory_retention_source_kind_check" CHECK ("source_kind" IN ('human_confirmed', 'system_migration'));
ALTER TABLE "question_generation_attempt" ADD CONSTRAINT "question_attempt_kind_check" CHECK ("attempt_kind" IN ('automatic', 'manual_next', 'second_session_opening'));
ALTER TABLE "question_generation_attempt" ADD CONSTRAINT "question_attempt_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled'));
ALTER TABLE "question_generation_attempt" ADD CONSTRAINT "question_attempt_result_check" CHECK ("result_kind" IS NULL OR "result_kind" IN ('suggestion', 'continue_listening', 'unavailable'));
ALTER TABLE "question_generation_attempt" ADD CONSTRAINT "question_attempt_publication_check" CHECK ("publication_outcome" IS NULL OR "publication_outcome" IN ('published', 'not_better', 'duplicate_filtered', 'stale_basis', 'superseded_by_manual', 'policy_blocked', 'not_applicable'));
ALTER TABLE "question_display_state" ADD CONSTRAINT "question_display_presentation_check" CHECK ("presentation_kind" IN ('suggestion', 'continue_listening', 'unavailable'));
ALTER TABLE "question_display_state" ADD CONSTRAINT "question_display_visibility_check" CHECK ("visibility" IN ('visible', 'withdrawn', 'none'));
ALTER TABLE "question_evidence_event" ADD CONSTRAINT "question_event_type_check" CHECK ("event_type" IN ('displayed', 'automatic_replace_succeeded', 'manual_next_requested', 'manual_next_committed', 'manual_next_failed', 'presentation_continue_listening', 'presentation_unavailable', 'hard_withdrawn'));
ALTER TABLE "actual_question_analysis" ADD CONSTRAINT "actual_analysis_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'superseded'));
ALTER TABLE "actual_question_analysis" ADD CONSTRAINT "actual_analysis_judgeability_check" CHECK ("judgeability" IN ('judgeable', 'unjudged'));
ALTER TABLE "actual_question_analysis" ADD CONSTRAINT "actual_analysis_transcript_status_check" CHECK ("transcript_status" IN ('pending', 'draining', 'drained', 'degraded', 'not_started'));
ALTER TABLE "actual_question" ADD CONSTRAINT "actual_question_source_check" CHECK ("source_kind" IN ('interviewer_spontaneous', 'matched_system_suggestion'));
ALTER TABLE "suggestion_outcome" ADD CONSTRAINT "suggestion_outcome_value_check" CHECK ("outcome" IN ('actual_asked', 'explicitly_replaced', 'not_observed', 'unjudged'));
ALTER TABLE "ai_retention_cleanup_audit" ADD CONSTRAINT "ai_cleanup_audit_outcome_check" CHECK ("outcome" IN ('purged', 'failed'));
ALTER TABLE "ai_derived_output" ADD CONSTRAINT "ai_derived_expected_counts_nonnegative" CHECK (
  "expected_segment_count" >= 0 AND "expected_memory_count" >= 0 AND "expected_question_count" >= 0
);
ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_exactly_one_root" CHECK (
  ("authority" = 'automatic' AND "ai_job_id" IS NOT NULL AND "ai_derived_output_id" IS NOT NULL AND "memory_retention_root_id" IS NULL)
  OR ("authority" IN ('human_confirmed', 'system_migration') AND "ai_job_id" IS NULL AND "ai_derived_output_id" IS NULL AND "memory_retention_root_id" IS NOT NULL)
);
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_exactly_one_root" CHECK (
  ("authority" = 'automatic' AND "ai_job_id" IS NOT NULL AND "ai_derived_output_id" IS NOT NULL AND "memory_retention_root_id" IS NULL)
  OR ("authority" IN ('human_confirmed', 'system_migration') AND "ai_job_id" IS NULL AND "ai_derived_output_id" IS NULL AND "memory_retention_root_id" IS NOT NULL)
);
ALTER TABLE "question_evidence_event" ADD CONSTRAINT "question_event_exactly_one_root" CHECK (
  ("retention_owner_kind" = 'ai_job' AND "retention_ai_job_id" IS NOT NULL AND "retention_display_snapshot_id" IS NULL)
  OR ("retention_owner_kind" = 'display_snapshot' AND "retention_ai_job_id" IS NULL AND "retention_display_snapshot_id" IS NOT NULL)
);
ALTER TABLE "actual_question_analysis" ADD CONSTRAINT "actual_catalog_publication_check" CHECK (
  NOT "is_current_published" OR ("status" = 'succeeded' AND "judgeability" = 'judgeable' AND "published_at" IS NOT NULL AND "ai_derived_output_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "memory_resolution_one_current_slot_key"
  ON "memory_resolution"("project_id", "memory_type", "canonical_key") WHERE "status" = 'current';
CREATE UNIQUE INDEX "actual_question_one_current_catalog_key"
  ON "actual_question_analysis"("session_id") WHERE "is_current_published";

-- Root-owned rows cascade. Cross-root history pointers detach or require the
-- authoritative cleanup transaction to invalidate first.
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_job_session_scope" ADD CONSTRAINT "ai_job_scope_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "ai_job_session_scope" ADD CONSTRAINT "ai_job_scope_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_job_input_segment" ADD CONSTRAINT "ai_job_segment_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "ai_job_input_segment" ADD CONSTRAINT "ai_job_segment_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_job_input_segment" ADD CONSTRAINT "ai_job_segment_transcript_fkey" FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segment"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_job_input_memory" ADD CONSTRAINT "ai_job_memory_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "ai_job_input_memory" ADD CONSTRAINT "ai_job_memory_resolution_fkey" FOREIGN KEY ("memory_resolution_id") REFERENCES "memory_resolution"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_provider_call" ADD CONSTRAINT "ai_provider_call_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "ai_derived_output" ADD CONSTRAINT "ai_derived_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "ai_derived_output" ADD CONSTRAINT "ai_derived_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "ai_output_segment_dependency" ADD CONSTRAINT "ai_output_segment_output_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE;
ALTER TABLE "ai_output_segment_dependency" ADD CONSTRAINT "ai_output_segment_input_fkey" FOREIGN KEY ("ai_job_input_segment_id") REFERENCES "ai_job_input_segment"("id") ON DELETE CASCADE;
ALTER TABLE "ai_output_memory_dependency" ADD CONSTRAINT "ai_output_memory_output_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE;
ALTER TABLE "ai_output_memory_dependency" ADD CONSTRAINT "ai_output_memory_input_fkey" FOREIGN KEY ("ai_job_input_memory_id") REFERENCES "ai_job_input_memory"("id") ON DELETE CASCADE;
ALTER TABLE "ai_output_question_dependency" ADD CONSTRAINT "ai_output_question_output_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE;
ALTER TABLE "memory_retention_root" ADD CONSTRAINT "memory_retention_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_retention_root_fkey" FOREIGN KEY ("memory_retention_root_id") REFERENCES "memory_retention_root"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim" ADD CONSTRAINT "memory_claim_derived_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_claim_evidence" ADD CONSTRAINT "memory_claim_evidence_claim_fkey" FOREIGN KEY ("memory_claim_id") REFERENCES "memory_claim"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim_evidence" ADD CONSTRAINT "memory_claim_evidence_input_fkey" FOREIGN KEY ("ai_job_input_segment_id") REFERENCES "ai_job_input_segment"("id") ON DELETE CASCADE;
ALTER TABLE "memory_claim_evidence" ADD CONSTRAINT "memory_claim_evidence_segment_fkey" FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segment"("id") ON DELETE RESTRICT;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_retention_root_fkey" FOREIGN KEY ("memory_retention_root_id") REFERENCES "memory_retention_root"("id") ON DELETE CASCADE;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_derived_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "memory_resolution" ADD CONSTRAINT "memory_resolution_supersedes_fkey" FOREIGN KEY ("supersedes_resolution_id") REFERENCES "memory_resolution"("id") ON DELETE SET NULL;
ALTER TABLE "memory_resolution_member" ADD CONSTRAINT "memory_resolution_member_resolution_fkey" FOREIGN KEY ("memory_resolution_id") REFERENCES "memory_resolution"("id") ON DELETE CASCADE;
ALTER TABLE "memory_resolution_member" ADD CONSTRAINT "memory_resolution_member_claim_fkey" FOREIGN KEY ("memory_claim_id") REFERENCES "memory_claim"("id") ON DELETE RESTRICT;
ALTER TABLE "question_generation_attempt" ADD CONSTRAINT "question_attempt_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "question_generation_attempt" ADD CONSTRAINT "question_attempt_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "question_candidate" ADD CONSTRAINT "question_candidate_attempt_fkey" FOREIGN KEY ("question_generation_attempt_id") REFERENCES "question_generation_attempt"("id") ON DELETE CASCADE;
ALTER TABLE "question_candidate" ADD CONSTRAINT "question_candidate_derived_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "question_display_snapshot" ADD CONSTRAINT "question_snapshot_candidate_fkey" FOREIGN KEY ("question_candidate_id") REFERENCES "question_candidate"("id") ON DELETE SET NULL;
ALTER TABLE "question_display_snapshot" ADD CONSTRAINT "question_snapshot_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "question_display_state" ADD CONSTRAINT "question_state_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "question_display_state" ADD CONSTRAINT "question_state_snapshot_fkey" FOREIGN KEY ("current_snapshot_id") REFERENCES "question_display_snapshot"("id") ON DELETE SET NULL;
ALTER TABLE "question_evidence_event" ADD CONSTRAINT "question_event_job_fkey" FOREIGN KEY ("retention_ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "question_evidence_event" ADD CONSTRAINT "question_event_snapshot_fkey" FOREIGN KEY ("retention_display_snapshot_id") REFERENCES "question_display_snapshot"("id") ON DELETE CASCADE;
ALTER TABLE "question_evidence_event" ADD CONSTRAINT "question_event_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "question_evidence_event" ADD CONSTRAINT "question_event_fact_snapshot_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "question_display_snapshot"("id") ON DELETE SET NULL;
ALTER TABLE "actual_question_analysis" ADD CONSTRAINT "actual_analysis_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "actual_question_analysis" ADD CONSTRAINT "actual_analysis_derived_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "actual_question_analysis" ADD CONSTRAINT "actual_analysis_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "actual_question_analysis" ADD CONSTRAINT "actual_analysis_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "actual_question" ADD CONSTRAINT "actual_question_analysis_fkey" FOREIGN KEY ("actual_question_analysis_id") REFERENCES "actual_question_analysis"("id") ON DELETE CASCADE;
ALTER TABLE "actual_question" ADD CONSTRAINT "actual_question_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "actual_question_evidence" ADD CONSTRAINT "actual_question_evidence_question_fkey" FOREIGN KEY ("actual_question_id") REFERENCES "actual_question"("id") ON DELETE CASCADE;
ALTER TABLE "actual_question_evidence" ADD CONSTRAINT "actual_question_evidence_input_fkey" FOREIGN KEY ("ai_job_input_segment_id") REFERENCES "ai_job_input_segment"("id") ON DELETE CASCADE;
ALTER TABLE "actual_question_evidence" ADD CONSTRAINT "actual_question_evidence_segment_fkey" FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segment"("id") ON DELETE RESTRICT;
ALTER TABLE "suggestion_outcome" ADD CONSTRAINT "suggestion_outcome_analysis_fkey" FOREIGN KEY ("actual_question_analysis_id") REFERENCES "actual_question_analysis"("id") ON DELETE CASCADE;
ALTER TABLE "suggestion_outcome" ADD CONSTRAINT "suggestion_outcome_snapshot_fkey" FOREIGN KEY ("question_display_snapshot_id") REFERENCES "question_display_snapshot"("id") ON DELETE SET NULL;
ALTER TABLE "interview_context_snapshot" ADD CONSTRAINT "context_snapshot_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "interview_context_snapshot" ADD CONSTRAINT "context_snapshot_derived_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "interview_context_snapshot" ADD CONSTRAINT "context_snapshot_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "interview_context_snapshot" ADD CONSTRAINT "context_snapshot_session_fkey" FOREIGN KEY ("consumer_session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "context_snapshot_memory" ADD CONSTRAINT "context_memory_snapshot_fkey" FOREIGN KEY ("context_snapshot_id") REFERENCES "interview_context_snapshot"("id") ON DELETE CASCADE;
ALTER TABLE "context_snapshot_memory" ADD CONSTRAINT "context_memory_resolution_fkey" FOREIGN KEY ("memory_resolution_id") REFERENCES "memory_resolution"("id") ON DELETE RESTRICT;
ALTER TABLE "context_snapshot_actual_question" ADD CONSTRAINT "context_actual_snapshot_fkey" FOREIGN KEY ("context_snapshot_id") REFERENCES "interview_context_snapshot"("id") ON DELETE CASCADE;
ALTER TABLE "context_snapshot_actual_question" ADD CONSTRAINT "context_actual_question_fkey" FOREIGN KEY ("actual_question_id") REFERENCES "actual_question"("id") ON DELETE RESTRICT;
ALTER TABLE "boundary_candidate" ADD CONSTRAINT "boundary_candidate_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "boundary_candidate" ADD CONSTRAINT "boundary_candidate_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "boundary_candidate" ADD CONSTRAINT "boundary_candidate_derived_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "generated_session_note" ADD CONSTRAINT "session_note_job_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE;
ALTER TABLE "generated_session_note" ADD CONSTRAINT "session_note_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE;
ALTER TABLE "generated_session_note" ADD CONSTRAINT "session_note_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "generated_session_note" ADD CONSTRAINT "session_note_derived_fkey" FOREIGN KEY ("ai_derived_output_id") REFERENCES "ai_derived_output"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- Cross-table identity is checked at commit so root and derived rows can be
-- inserted in either order inside one publication transaction.
CREATE FUNCTION verify_ai_derived_output_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matches integer;
BEGIN
  SELECT CASE NEW.output_type
    WHEN 'memory_claim' THEN (SELECT count(*) FROM memory_claim r WHERE r.id=NEW.business_output_id AND r.ai_derived_output_id=NEW.id AND r.ai_job_id=NEW.ai_job_id AND r.project_id=NEW.project_id)
    WHEN 'memory_resolution' THEN (SELECT count(*) FROM memory_resolution r WHERE r.id=NEW.business_output_id AND r.ai_derived_output_id=NEW.id AND r.ai_job_id=NEW.ai_job_id AND r.project_id=NEW.project_id)
    WHEN 'question_candidate' THEN (SELECT count(*) FROM question_candidate r JOIN question_generation_attempt a ON a.id=r.question_generation_attempt_id JOIN interview_session s ON s.id=a.session_id WHERE r.id=NEW.business_output_id AND r.ai_derived_output_id=NEW.id AND a.ai_job_id=NEW.ai_job_id AND s.project_id=NEW.project_id)
    WHEN 'boundary_candidate' THEN (SELECT count(*) FROM boundary_candidate r WHERE r.id=NEW.business_output_id AND r.ai_derived_output_id=NEW.id AND r.ai_job_id=NEW.ai_job_id AND r.project_id=NEW.project_id)
    WHEN 'actual_question_catalog' THEN (SELECT count(*) FROM actual_question_analysis r WHERE r.id=NEW.business_output_id AND r.ai_derived_output_id=NEW.id AND r.ai_job_id=NEW.ai_job_id AND r.project_id=NEW.project_id)
    WHEN 'session_note' THEN (SELECT count(*) FROM generated_session_note r WHERE r.id=NEW.business_output_id AND r.ai_derived_output_id=NEW.id AND r.ai_job_id=NEW.ai_job_id AND r.project_id=NEW.project_id)
    WHEN 'context_snapshot' THEN (SELECT count(*) FROM interview_context_snapshot r WHERE r.id=NEW.business_output_id AND r.ai_derived_output_id=NEW.id AND r.ai_job_id=NEW.ai_job_id AND r.project_id=NEW.project_id)
  END INTO matches;
  IF matches <> 1 THEN RAISE EXCEPTION 'AI_DERIVED_OUTPUT_IDENTITY_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "ai_derived_output_identity_deferred"
AFTER INSERT OR UPDATE ON "ai_derived_output" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_ai_derived_output_identity();

COMMENT ON COLUMN "elder_project"."ai_policy_revision" IS 'Monotonic policy drift evidence; never substitutes for live assignment/consent/restriction/deletion checks.';
COMMENT ON TABLE "ai_retention_cleanup_audit" IS 'Minimal hashed cleanup audit; never stores transcript, prompt, provider output, or sensitive body text.';
