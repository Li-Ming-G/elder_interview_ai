CREATE TYPE "FinalizationAudioStatus" AS ENUM ('awaiting_upload', 'verifying', 'complete', 'unrecoverable');
CREATE TYPE "FinalizationTranscriptStatus" AS ENUM ('pending', 'draining', 'drained', 'degraded', 'not_started');

CREATE UNIQUE INDEX "audio_object_one_interview_per_session"
ON "audio_object" ("session_id") WHERE "purpose" = 'interview' AND "session_id" IS NOT NULL;

CREATE TABLE "session_finalization" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "audio_object_id" UUID NOT NULL,
  "stop_request_id" UUID NOT NULL,
  "expected_chunk_count" INTEGER NOT NULL CHECK ("expected_chunk_count" > 0),
  "commitments_checksum" CHAR(64) NOT NULL,
  "capture_ended_at" TIMESTAMPTZ(3) NOT NULL,
  "processing_started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "audio_status" "FinalizationAudioStatus" NOT NULL DEFAULT 'awaiting_upload',
  "transcript_status" "FinalizationTranscriptStatus" NOT NULL DEFAULT 'pending',
  "transcript_error_code" VARCHAR(40),
  "asr_last_audio_sequence_accepted" INTEGER,
  "asr_drain_completed_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR(50),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "session_finalization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "session_finalization_session_id_key" UNIQUE ("session_id"),
  CONSTRAINT "session_finalization_audio_object_id_key" UNIQUE ("audio_object_id"),
  CONSTRAINT "session_finalization_stop_request_id_key" UNIQUE ("stop_request_id"),
  CONSTRAINT "session_finalization_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE,
  CONSTRAINT "session_finalization_audio_object_id_fkey" FOREIGN KEY ("audio_object_id") REFERENCES "audio_object"("id") ON DELETE RESTRICT
);

CREATE TABLE "session_finalization_chunk" (
  "id" UUID NOT NULL,
  "session_finalization_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL CHECK ("sequence_no" >= 0),
  "start_ms" INTEGER NOT NULL CHECK ("start_ms" >= 0),
  "end_ms" INTEGER NOT NULL,
  "size_bytes" INTEGER NOT NULL CHECK ("size_bytes" > 0),
  "checksum" CHAR(64) NOT NULL,
  "mime_type" VARCHAR(160) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_finalization_chunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "session_finalization_chunk_timeline" CHECK ("end_ms" > "start_ms"),
  CONSTRAINT "session_finalization_chunk_session_finalization_id_sequence_no_key" UNIQUE ("session_finalization_id", "sequence_no"),
  CONSTRAINT "session_finalization_chunk_session_finalization_id_fkey" FOREIGN KEY ("session_finalization_id") REFERENCES "session_finalization"("id") ON DELETE CASCADE
);
