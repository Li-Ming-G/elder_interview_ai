CREATE TYPE "SpeakerRemapPreviewStatus" AS ENUM ('active', 'executed', 'expired', 'invalidated');
CREATE TYPE "SpeakerCorrectionOperationType" AS ENUM ('single', 'batch');

CREATE TABLE "speaker_remap_preview" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "speaker_stream_id" UUID NOT NULL,
  "speaker_provider_id" VARCHAR(200) NOT NULL,
  "target_role" "SpeakerRole" NOT NULL,
  "segment_start_id" UUID NOT NULL,
  "segment_end_id" UUID NOT NULL,
  "exclude_individual_corrections" BOOLEAN NOT NULL DEFAULT true,
  "candidate_segment_count" INTEGER NOT NULL,
  "excluded_segment_count" INTEGER NOT NULL,
  "segment_count" INTEGER NOT NULL,
  "preview_hash" CHAR(64) NOT NULL,
  "status" "SpeakerRemapPreviewStatus" NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "request_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaker_remap_preview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "speaker_remap_preview_request_id_key" UNIQUE ("request_id"),
  CONSTRAINT "speaker_remap_preview_counts_check" CHECK (
    "candidate_segment_count" > 0 AND "excluded_segment_count" >= 0 AND "segment_count" > 0
    AND "candidate_segment_count" = "excluded_segment_count" + "segment_count"
    AND "exclude_individual_corrections" = true
  )
);
CREATE INDEX "speaker_remap_preview_session_id_status_expires_at_idx" ON "speaker_remap_preview"("session_id", "status", "expires_at");
ALTER TABLE "speaker_remap_preview" ADD CONSTRAINT "speaker_remap_preview_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "speaker_remap_preview" ADD CONSTRAINT "speaker_remap_preview_stream_session_fkey" FOREIGN KEY ("speaker_stream_id", "session_id") REFERENCES "speaker_stream"("id", "session_id") ON DELETE CASCADE;
ALTER TABLE "speaker_remap_preview" ADD CONSTRAINT "speaker_remap_preview_start_fkey" FOREIGN KEY ("segment_start_id") REFERENCES "transcript_segment"("id") ON DELETE RESTRICT;
ALTER TABLE "speaker_remap_preview" ADD CONSTRAINT "speaker_remap_preview_end_fkey" FOREIGN KEY ("segment_end_id") REFERENCES "transcript_segment"("id") ON DELETE RESTRICT;
ALTER TABLE "speaker_remap_preview" ADD CONSTRAINT "speaker_remap_preview_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE TABLE "speaker_remap_preview_segment" (
  "id" UUID NOT NULL,
  "speaker_remap_preview_id" UUID NOT NULL,
  "transcript_segment_id" UUID NOT NULL,
  "speaker_revision_at_preview" INTEGER NOT NULL,
  "excluded_individual_correction" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaker_remap_preview_segment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "speaker_remap_preview_segment_pair_key" UNIQUE ("speaker_remap_preview_id", "transcript_segment_id"),
  CONSTRAINT "speaker_remap_preview_segment_revision_check" CHECK ("speaker_revision_at_preview" >= 0)
);
CREATE INDEX "speaker_remap_preview_segment_transcript_segment_id_idx" ON "speaker_remap_preview_segment"("transcript_segment_id");
ALTER TABLE "speaker_remap_preview_segment" ADD CONSTRAINT "speaker_remap_preview_segment_preview_fkey" FOREIGN KEY ("speaker_remap_preview_id") REFERENCES "speaker_remap_preview"("id") ON DELETE CASCADE;
ALTER TABLE "speaker_remap_preview_segment" ADD CONSTRAINT "speaker_remap_preview_segment_segment_fkey" FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segment"("id") ON DELETE CASCADE;

CREATE TABLE "speaker_correction_operation" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "speaker_stream_id" UUID NOT NULL,
  "operation_type" "SpeakerCorrectionOperationType" NOT NULL,
  "target_role" "SpeakerRole" NOT NULL,
  "preview_id" UUID,
  "preview_hash" CHAR(64),
  "request_id" UUID NOT NULL,
  "revision_before" INTEGER NOT NULL,
  "revision_after" INTEGER NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaker_correction_operation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "speaker_correction_operation_preview_id_key" UNIQUE ("preview_id"),
  CONSTRAINT "speaker_correction_operation_request_id_key" UNIQUE ("request_id"),
  CONSTRAINT "speaker_correction_operation_session_revision_key" UNIQUE ("session_id", "revision_after"),
  CONSTRAINT "speaker_correction_operation_revision_check" CHECK ("revision_before" >= 0 AND "revision_after" = "revision_before" + 1),
  CONSTRAINT "speaker_correction_operation_preview_check" CHECK (
    ("operation_type" = 'single' AND "preview_id" IS NULL AND "preview_hash" IS NULL)
    OR ("operation_type" = 'batch' AND "preview_id" IS NOT NULL AND "preview_hash" IS NOT NULL)
  )
);
ALTER TABLE "speaker_correction_operation" ADD CONSTRAINT "speaker_correction_operation_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "speaker_correction_operation" ADD CONSTRAINT "speaker_correction_operation_stream_session_fkey" FOREIGN KEY ("speaker_stream_id", "session_id") REFERENCES "speaker_stream"("id", "session_id") ON DELETE CASCADE;
ALTER TABLE "speaker_correction_operation" ADD CONSTRAINT "speaker_correction_operation_preview_fkey" FOREIGN KEY ("preview_id") REFERENCES "speaker_remap_preview"("id") ON DELETE RESTRICT;
ALTER TABLE "speaker_correction_operation" ADD CONSTRAINT "speaker_correction_operation_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE TABLE "speaker_correction_operation_segment" (
  "id" UUID NOT NULL,
  "speaker_correction_operation_id" UUID NOT NULL,
  "transcript_segment_id" UUID NOT NULL,
  "speaker_revision_before" INTEGER NOT NULL,
  "speaker_revision_after" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaker_correction_operation_segment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "speaker_correction_operation_segment_pair_key" UNIQUE ("speaker_correction_operation_id", "transcript_segment_id"),
  CONSTRAINT "speaker_correction_membership_revision_check" CHECK ("speaker_revision_before" >= 0 AND "speaker_revision_after" > "speaker_revision_before")
);
CREATE INDEX "speaker_correction_operation_segment_transcript_segment_id_idx" ON "speaker_correction_operation_segment"("transcript_segment_id");
ALTER TABLE "speaker_correction_operation_segment" ADD CONSTRAINT "speaker_correction_membership_operation_fkey" FOREIGN KEY ("speaker_correction_operation_id") REFERENCES "speaker_correction_operation"("id") ON DELETE CASCADE;
ALTER TABLE "speaker_correction_operation_segment" ADD CONSTRAINT "speaker_correction_membership_segment_fkey" FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segment"("id") ON DELETE CASCADE;
