CREATE TABLE "decision_trace" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "owner_actor_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "generation_id" UUID NOT NULL,
    "ai_job_id" UUID,
    "attempt_id" UUID,
    "trigger_type" VARCHAR(32) NOT NULL,
    "decision_outcome" VARCHAR(32) NOT NULL,
    "director_invoked" BOOLEAN NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "stage" VARCHAR(40),
    "gate_reason" VARCHAR(80),
    "error_code" VARCHAR(80),
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "context_revision" INTEGER NOT NULL,
    "working_revision" INTEGER,
    "active_thread_id" UUID,
    "input_hash" CHAR(64) NOT NULL,
    "context_digest" CHAR(64),
    "stage_timings_json" JSONB NOT NULL,
    "retention_state" "RetentionState" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "retention_hidden_at" TIMESTAMPTZ(3),
    "retention_cleanup_request_id" UUID,
    "retention_cleanup_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "retention_cleanup_started_at" TIMESTAMPTZ(3),
    "retention_cleanup_error_code" VARCHAR(80),
    CONSTRAINT "decision_trace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "decision_trace_transcript_membership" (
    "id" UUID NOT NULL,
    "trace_id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "text_revision" INTEGER NOT NULL,
    "speaker_role_revision" INTEGER NOT NULL,
    "effective_text_digest" CHAR(64) NOT NULL,
    "input_order" INTEGER NOT NULL,
    CONSTRAINT "decision_trace_transcript_membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "decision_trace_memory_membership" (
    "id" UUID NOT NULL,
    "trace_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "layer" VARCHAR(16) NOT NULL,
    "revision" INTEGER NOT NULL,
    "membership_role" VARCHAR(16) NOT NULL,
    "input_order" INTEGER NOT NULL,
    CONSTRAINT "decision_trace_memory_membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "decision_trace_p3_candidate" (
    "id" UUID NOT NULL,
    "trace_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "source_layer" VARCHAR(16) NOT NULL,
    "retrieval_sources" TEXT[] NOT NULL,
    "embedding_score" DECIMAL(6,5),
    "graph_distance" INTEGER,
    "rank" INTEGER NOT NULL,
    "included" BOOLEAN NOT NULL,
    "exclusion_reason" VARCHAR(80),
    CONSTRAINT "decision_trace_p3_candidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "decision_trace_p4_membership" (
    "id" UUID NOT NULL,
    "trace_id" UUID NOT NULL,
    "section" VARCHAR(32) NOT NULL,
    "source_type" VARCHAR(32) NOT NULL,
    "source_id" VARCHAR(160) NOT NULL,
    "revision" INTEGER,
    "revision_status" VARCHAR(16) NOT NULL DEFAULT 'unavailable',
    "membership_digest" CHAR(64),
    "input_order" INTEGER NOT NULL,
    "included" BOOLEAN NOT NULL,
    "drop_reason" VARCHAR(80),
    CONSTRAINT "decision_trace_p4_membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "decision_trace_evidence_call" (
    "id" UUID NOT NULL,
    "trace_id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "tool" VARCHAR(40) NOT NULL,
    "target_type" VARCHAR(24) NOT NULL,
    "target_id" UUID NOT NULL,
    "result_ids" UUID[] NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "invocation_no" INTEGER NOT NULL,
    "request_digest" CHAR(64),
    "result_digest" CHAR(64),
    CONSTRAINT "decision_trace_evidence_call_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decision_trace_request_id_key" ON "decision_trace"("request_id");
CREATE UNIQUE INDEX "decision_trace_generation_id_key" ON "decision_trace"("generation_id");
CREATE UNIQUE INDEX "decision_trace_attempt_id_key" ON "decision_trace"("attempt_id");
CREATE INDEX "decision_trace_project_session_created_idx" ON "decision_trace"("project_id", "session_id", "created_at" DESC);
CREATE INDEX "decision_trace_retention_idx" ON "decision_trace"("retention_state", "expires_at");
CREATE UNIQUE INDEX "decision_trace_transcript_trace_segment_key" ON "decision_trace_transcript_membership"("trace_id", "segment_id");
CREATE UNIQUE INDEX "decision_trace_transcript_trace_order_key" ON "decision_trace_transcript_membership"("trace_id", "input_order");
CREATE UNIQUE INDEX "decision_trace_memory_trace_memory_revision_key" ON "decision_trace_memory_membership"("trace_id", "memory_id", "revision");
CREATE UNIQUE INDEX "decision_trace_memory_trace_order_key" ON "decision_trace_memory_membership"("trace_id", "input_order");
CREATE UNIQUE INDEX "decision_trace_p3_trace_candidate_key" ON "decision_trace_p3_candidate"("trace_id", "candidate_id");
CREATE INDEX "decision_trace_p3_trace_rank_idx" ON "decision_trace_p3_candidate"("trace_id", "rank");
CREATE UNIQUE INDEX "decision_trace_p4_trace_section_source_order_key" ON "decision_trace_p4_membership"("trace_id", "section", "source_id", "input_order");
CREATE UNIQUE INDEX "decision_trace_evidence_trace_call_key" ON "decision_trace_evidence_call"("trace_id", "call_id");
CREATE UNIQUE INDEX "decision_trace_evidence_trace_invocation_key" ON "decision_trace_evidence_call"("trace_id", "invocation_no");

ALTER TABLE "decision_trace" ADD CONSTRAINT "decision_trace_project_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_trace" ADD CONSTRAINT "decision_trace_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_trace" ADD CONSTRAINT "decision_trace_owner_fkey" FOREIGN KEY ("owner_actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_trace_transcript_membership" ADD CONSTRAINT "decision_trace_transcript_trace_fkey" FOREIGN KEY ("trace_id") REFERENCES "decision_trace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_trace_memory_membership" ADD CONSTRAINT "decision_trace_memory_trace_fkey" FOREIGN KEY ("trace_id") REFERENCES "decision_trace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_trace_p3_candidate" ADD CONSTRAINT "decision_trace_p3_trace_fkey" FOREIGN KEY ("trace_id") REFERENCES "decision_trace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_trace_p4_membership" ADD CONSTRAINT "decision_trace_p4_trace_fkey" FOREIGN KEY ("trace_id") REFERENCES "decision_trace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_trace_evidence_call" ADD CONSTRAINT "decision_trace_evidence_trace_fkey" FOREIGN KEY ("trace_id") REFERENCES "decision_trace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
