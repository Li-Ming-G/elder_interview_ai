CREATE TYPE "CaptureFailureCode" AS ENUM ('NO_AUDIO_CAPTURED');
CREATE TYPE "CaptureGenerationStatus" AS ENUM ('preparing', 'active', 'interrupted', 'stopped', 'abandoned_empty');
CREATE TYPE "CaptureInterruptionReason" AS ENUM (
  'capture_start_failed',
  'page_recovery_detected',
  'microphone_ended',
  'recorder_error',
  'local_archive_failed',
  'auth_lost',
  'unknown'
);

ALTER TABLE "interview_session"
ADD COLUMN "capture_failure_code" "CaptureFailureCode",
ADD CONSTRAINT "interview_session_capture_failure_terminal" CHECK (
  "capture_failure_code" IS NULL OR "status" = 'failed'
);

CREATE UNIQUE INDEX "audio_object_id_session_id_key"
ON "audio_object" ("id", "session_id");

CREATE TABLE "session_capture_generation" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "audio_object_id" UUID NOT NULL,
  "generation_no" INTEGER NOT NULL,
  "audio_stream_id" UUID NOT NULL,
  "timeline_offset_ms" INTEGER NOT NULL,
  "status" "CaptureGenerationStatus" NOT NULL DEFAULT 'preparing',
  "interruption_reason" "CaptureInterruptionReason",
  "confirmed_active_at" TIMESTAMPTZ(3),
  "first_pcm_accepted_at" TIMESTAMPTZ(3),
  "interrupted_at" TIMESTAMPTZ(3),
  "stopped_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "session_capture_generation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "session_capture_generation_generation_nonnegative" CHECK ("generation_no" >= 0),
  CONSTRAINT "session_capture_generation_timeline_nonnegative" CHECK ("timeline_offset_ms" >= 0),
  CONSTRAINT "session_capture_generation_zero_offset" CHECK ("generation_no" <> 0 OR "timeline_offset_ms" = 0),
  CONSTRAINT "session_capture_generation_state_facts" CHECK (
    ("status" = 'preparing' AND "interruption_reason" IS NULL AND "confirmed_active_at" IS NULL AND "interrupted_at" IS NULL AND "stopped_at" IS NULL)
    OR ("status" = 'active' AND "interruption_reason" IS NULL AND "confirmed_active_at" IS NOT NULL AND "interrupted_at" IS NULL AND "stopped_at" IS NULL)
    OR ("status" = 'interrupted' AND "interruption_reason" IS NOT NULL AND "interrupted_at" IS NOT NULL AND "stopped_at" IS NULL)
    OR ("status" = 'stopped' AND "interruption_reason" IS NULL AND "interrupted_at" IS NULL AND "stopped_at" IS NOT NULL)
    OR ("status" = 'abandoned_empty' AND "interruption_reason" IS NOT NULL AND "interrupted_at" IS NOT NULL AND "stopped_at" IS NOT NULL)
  ),
  CONSTRAINT "session_capture_generation_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE,
  CONSTRAINT "session_capture_generation_audio_object_id_fkey" FOREIGN KEY ("audio_object_id") REFERENCES "audio_object"("id") ON DELETE RESTRICT,
  CONSTRAINT "session_capture_generation_audio_session_fkey" FOREIGN KEY ("audio_object_id", "session_id") REFERENCES "audio_object"("id", "session_id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "session_capture_generation_audio_stream_id_key"
ON "session_capture_generation" ("audio_stream_id");

CREATE UNIQUE INDEX "session_capture_generation_session_id_generation_no_key"
ON "session_capture_generation" ("session_id", "generation_no");

CREATE INDEX "session_capture_generation_session_id_status_idx"
ON "session_capture_generation" ("session_id", "status");

CREATE UNIQUE INDEX "session_capture_generation_one_current"
ON "session_capture_generation" ("session_id")
WHERE "status" IN ('preparing', 'active');
