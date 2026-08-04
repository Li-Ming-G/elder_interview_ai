-- CreateEnum
CREATE TYPE "AudioPurpose" AS ENUM ('consent', 'interview');
CREATE TYPE "AudioObjectStatus" AS ENUM ('initiated', 'uploading', 'complete', 'failed');
CREATE TYPE "AudioChunkUploadStatus" AS ENUM ('pending', 'uploading', 'uploaded', 'failed', 'missing');

-- CreateTable
CREATE TABLE "audio_object" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "session_id" UUID,
    "purpose" "AudioPurpose" NOT NULL,
    "status" "AudioObjectStatus" NOT NULL DEFAULT 'initiated',
    "mime_type" VARCHAR(160) NOT NULL,
    "chunk_count" INTEGER,
    "total_size_bytes" BIGINT,
    "manifest_checksum" CHAR(64),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    CONSTRAINT "audio_object_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audio_object_purpose_session" CHECK (
      ("purpose" = 'consent' AND "session_id" IS NULL) OR
      ("purpose" = 'interview' AND "session_id" IS NOT NULL)
    ),
    CONSTRAINT "audio_object_completion" CHECK (
      ("status" = 'complete' AND "chunk_count" IS NOT NULL AND "chunk_count" > 0 AND "total_size_bytes" IS NOT NULL AND "total_size_bytes" >= 0 AND "manifest_checksum" IS NOT NULL AND "completed_at" IS NOT NULL) OR
      ("status" <> 'complete' AND "chunk_count" IS NULL AND "total_size_bytes" IS NULL AND "manifest_checksum" IS NULL AND "completed_at" IS NULL)
    )
);

CREATE TABLE "audio_chunk" (
    "id" UUID NOT NULL,
    "audio_object_id" UUID NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "upload_status" "AudioChunkUploadStatus" NOT NULL DEFAULT 'uploaded',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMPTZ(3),
    CONSTRAINT "audio_chunk_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audio_chunk_values" CHECK (
      "sequence_no" >= 0 AND "start_ms" >= 0 AND "end_ms" > "start_ms" AND
      "size_bytes" > 0 AND "retry_count" >= 0
    )
);

-- CreateIndex
CREATE INDEX "audio_object_project_id_purpose_created_at_idx" ON "audio_object"("project_id", "purpose", "created_at" DESC);
CREATE INDEX "audio_object_session_id_purpose_idx" ON "audio_object"("session_id", "purpose");
CREATE UNIQUE INDEX "audio_chunk_audio_object_id_sequence_no_key" ON "audio_chunk"("audio_object_id", "sequence_no");

-- AddForeignKey
ALTER TABLE "audio_object" ADD CONSTRAINT "audio_object_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "elder_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audio_object" ADD CONSTRAINT "audio_object_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audio_object" ADD CONSTRAINT "audio_object_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audio_chunk" ADD CONSTRAINT "audio_chunk_audio_object_id_fkey" FOREIGN KEY ("audio_object_id") REFERENCES "audio_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_consent_audio_object_id_fkey" FOREIGN KEY ("consent_audio_object_id") REFERENCES "audio_object"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
