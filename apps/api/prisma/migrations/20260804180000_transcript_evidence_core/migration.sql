-- CreateEnum
CREATE TYPE "SpeakerRole" AS ENUM ('elder', 'interviewer', 'unknown');
CREATE TYPE "SpeakerMappingSource" AS ENUM ('calibration', 'manual', 'provider', 'batch_remap');
CREATE TYPE "TranscriptSource" AS ENUM ('realtime', 'backfill', 'fixture');

-- CreateTable
CREATE TABLE "speaker_mapping" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "speaker_provider_id" VARCHAR(200) NOT NULL,
    "speaker_role" "SpeakerRole" NOT NULL,
    "source" "SpeakerMappingSource" NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(3),
    CONSTRAINT "speaker_mapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transcript_segment" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "ingest_key" VARCHAR(240) NOT NULL,
    "provider_segment_id" VARCHAR(200),
    "speaker_provider_id" VARCHAR(200),
    "original_speaker_role" "SpeakerRole" NOT NULL DEFAULT 'unknown',
    "corrected_speaker_role" "SpeakerRole",
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "original_text" TEXT NOT NULL,
    "corrected_text" TEXT,
    "source" "TranscriptSource" NOT NULL,
    "provider_payload" JSONB,
    "corrected_by" UUID,
    "corrected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transcript_segment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transcript_segment_time_range" CHECK (
      "start_ms" >= 0 AND "end_ms" > "start_ms"
    ),
    CONSTRAINT "transcript_segment_provider_payload_size" CHECK (
      "provider_payload" IS NULL OR octet_length("provider_payload"::text) <= 65536
    )
);

-- CreateIndex
CREATE INDEX "speaker_mapping_session_id_speaker_provider_id_superseded_at_idx"
  ON "speaker_mapping"("session_id", "speaker_provider_id", "superseded_at");
CREATE UNIQUE INDEX "speaker_mapping_current_key"
  ON "speaker_mapping"("session_id", "speaker_provider_id")
  WHERE "superseded_at" IS NULL;
CREATE UNIQUE INDEX "transcript_segment_session_id_ingest_key_key"
  ON "transcript_segment"("session_id", "ingest_key");
CREATE INDEX "transcript_segment_session_id_start_ms_idx"
  ON "transcript_segment"("session_id", "start_ms");
CREATE INDEX "transcript_segment_session_id_created_at_idx"
  ON "transcript_segment"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "speaker_mapping" ADD CONSTRAINT "speaker_mapping_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speaker_mapping" ADD CONSTRAINT "speaker_mapping_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_corrected_by_fkey"
  FOREIGN KEY ("corrected_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
