CREATE TYPE "SpeakerStreamStatus" AS ENUM ('active', 'closed');
CREATE TYPE "SpeakerCalibrationAttemptStatus" AS ENUM ('collecting', 'confirmed', 'failed', 'skipped');
CREATE TYPE "SpeakerRoleAuthority" AS ENUM ('unconfirmed', 'user_confirmed');
CREATE TYPE "TranscriptContentKind" AS ENUM ('conversation', 'speaker_calibration');

ALTER TABLE "interview_session"
  ADD COLUMN "speaker_role_revision" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "interview_session_speaker_role_revision_nonnegative" CHECK ("speaker_role_revision" >= 0);
ALTER TABLE "session_capture_generation" ADD CONSTRAINT "capture_generation_id_session_audio_key" UNIQUE ("id", "session_id", "audio_stream_id");

CREATE TABLE "speaker_stream" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "capture_generation_id" UUID,
  "status" "SpeakerStreamStatus" NOT NULL DEFAULT 'active',
  "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaker_stream_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "speaker_stream_id_session_key" UNIQUE ("id", "session_id"),
  CONSTRAINT "speaker_stream_id_session_generation_key" UNIQUE ("id", "session_id", "capture_generation_id"),
  CONSTRAINT "speaker_stream_lifecycle_check" CHECK (
    ("status" = 'active' AND "capture_generation_id" IS NOT NULL AND "closed_at" IS NULL)
    OR ("status" = 'closed' AND "closed_at" IS NOT NULL)
  )
);
CREATE INDEX "speaker_stream_session_status_idx" ON "speaker_stream"("session_id", "status");
CREATE UNIQUE INDEX "speaker_stream_one_active_per_session" ON "speaker_stream"("session_id") WHERE "status" = 'active';
ALTER TABLE "speaker_stream" ADD CONSTRAINT "speaker_stream_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "speaker_stream" ADD CONSTRAINT "speaker_stream_generation_fkey" FOREIGN KEY ("capture_generation_id") REFERENCES "session_capture_generation"("id") ON DELETE RESTRICT;

-- Preserve legacy DEV-004A/B evidence in a closed, explicitly untrusted namespace.
INSERT INTO "speaker_stream" ("id", "session_id", "capture_generation_id", "status", "opened_at", "closed_at")
SELECT gen_random_uuid(), s."id", NULL, 'closed', s."created_at", CURRENT_TIMESTAMP
FROM "interview_session" s
WHERE EXISTS (SELECT 1 FROM "speaker_mapping" m WHERE m."session_id" = s."id")
   OR EXISTS (SELECT 1 FROM "transcript_segment" t WHERE t."session_id" = s."id");

ALTER TABLE "speaker_mapping"
  ADD COLUMN "speaker_stream_id" UUID,
  ADD COLUMN "authority" "SpeakerRoleAuthority" NOT NULL DEFAULT 'unconfirmed';
UPDATE "speaker_mapping" m SET "speaker_stream_id" = s."id"
FROM "speaker_stream" s WHERE s."session_id" = m."session_id" AND s."status" = 'closed';
ALTER TABLE "speaker_mapping" ALTER COLUMN "speaker_stream_id" SET NOT NULL;
DROP INDEX IF EXISTS "speaker_mapping_session_id_speaker_provider_id_superseded_at_idx";
DROP INDEX IF EXISTS "speaker_mapping_session_id_speaker_provider_id_superseded_at_id";
CREATE INDEX "speaker_mapping_stream_provider_current_idx" ON "speaker_mapping"("speaker_stream_id", "speaker_provider_id", "superseded_at");
CREATE UNIQUE INDEX "speaker_mapping_one_current_per_stream_label" ON "speaker_mapping"("speaker_stream_id", "speaker_provider_id") WHERE "superseded_at" IS NULL;
ALTER TABLE "speaker_mapping" ADD CONSTRAINT "speaker_mapping_stream_session_fkey" FOREIGN KEY ("speaker_stream_id", "session_id") REFERENCES "speaker_stream"("id", "session_id") ON DELETE CASCADE;
ALTER TABLE "speaker_mapping" ADD CONSTRAINT "speaker_mapping_authority_check" CHECK (
  "authority" = 'unconfirmed'
  OR ("source" IN ('calibration', 'manual', 'batch_remap') AND "authority" = 'user_confirmed')
);

ALTER TABLE "transcript_segment"
  ADD COLUMN "speaker_stream_id" UUID,
  ADD COLUMN "original_role_authority" "SpeakerRoleAuthority" NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN "speaker_role_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "content_kind" "TranscriptContentKind" NOT NULL DEFAULT 'conversation';
UPDATE "transcript_segment" t SET "speaker_stream_id" = s."id"
FROM "speaker_stream" s WHERE s."session_id" = t."session_id" AND s."status" = 'closed';
ALTER TABLE "transcript_segment" ALTER COLUMN "speaker_stream_id" SET NOT NULL;
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_stream_session_fkey" FOREIGN KEY ("speaker_stream_id", "session_id") REFERENCES "speaker_stream"("id", "session_id") ON DELETE RESTRICT;
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_role_revision_nonnegative" CHECK ("speaker_role_revision" >= 0);

CREATE TABLE "speaker_calibration_attempt" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "speaker_stream_id" UUID NOT NULL,
  "capture_generation_id" UUID NOT NULL,
  "audio_stream_id" UUID NOT NULL,
  "attempt_no" INTEGER NOT NULL,
  "status" "SpeakerCalibrationAttemptStatus" NOT NULL DEFAULT 'collecting',
  "start_sequence_no" INTEGER NOT NULL,
  "start_timeline_ms" INTEGER NOT NULL,
  "end_sequence_no" INTEGER,
  "end_timeline_ms" INTEGER,
  "started_request_id" UUID NOT NULL,
  "resolved_request_id" UUID,
  "started_by" UUID NOT NULL,
  "resolved_by" UUID,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaker_calibration_attempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "speaker_calibration_started_request_key" UNIQUE ("started_request_id"),
  CONSTRAINT "speaker_calibration_resolved_request_key" UNIQUE ("resolved_request_id"),
  CONSTRAINT "speaker_calibration_stream_attempt_key" UNIQUE ("speaker_stream_id", "attempt_no"),
  CONSTRAINT "speaker_calibration_boundary_check" CHECK (
    "attempt_no" > 0 AND "start_sequence_no" >= 0 AND "start_timeline_ms" >= 0 AND
    (("status" = 'collecting' AND "end_sequence_no" IS NULL AND "end_timeline_ms" IS NULL AND "resolved_request_id" IS NULL AND "resolved_by" IS NULL AND "resolved_at" IS NULL)
      OR ("status" <> 'collecting' AND "end_sequence_no" IS NOT NULL AND "end_timeline_ms" IS NOT NULL AND "resolved_request_id" IS NOT NULL AND "resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL
        AND "end_sequence_no" >= "start_sequence_no" AND "end_timeline_ms" >= "start_timeline_ms"))
  )
);
CREATE INDEX "speaker_calibration_attempt_stream_status_idx" ON "speaker_calibration_attempt"("speaker_stream_id", "status");
CREATE UNIQUE INDEX "speaker_calibration_one_collecting_per_stream" ON "speaker_calibration_attempt"("speaker_stream_id") WHERE "status" = 'collecting';
ALTER TABLE "speaker_calibration_attempt" ADD CONSTRAINT "speaker_calibration_session_fkey" FOREIGN KEY ("session_id") REFERENCES "interview_session"("id") ON DELETE CASCADE;
ALTER TABLE "speaker_calibration_attempt" ADD CONSTRAINT "speaker_calibration_stream_session_fkey" FOREIGN KEY ("speaker_stream_id", "session_id") REFERENCES "speaker_stream"("id", "session_id") ON DELETE CASCADE;
ALTER TABLE "speaker_calibration_attempt" ADD CONSTRAINT "speaker_calibration_generation_fkey" FOREIGN KEY ("capture_generation_id") REFERENCES "session_capture_generation"("id") ON DELETE RESTRICT;
ALTER TABLE "speaker_calibration_attempt" ADD CONSTRAINT "speaker_calibration_stream_identity_fkey" FOREIGN KEY ("speaker_stream_id", "session_id", "capture_generation_id") REFERENCES "speaker_stream"("id", "session_id", "capture_generation_id") ON DELETE CASCADE;
ALTER TABLE "speaker_calibration_attempt" ADD CONSTRAINT "speaker_calibration_capture_identity_fkey" FOREIGN KEY ("capture_generation_id", "session_id", "audio_stream_id") REFERENCES "session_capture_generation"("id", "session_id", "audio_stream_id") ON DELETE RESTRICT;
ALTER TABLE "speaker_calibration_attempt" ADD CONSTRAINT "speaker_calibration_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "speaker_calibration_attempt" ADD CONSTRAINT "speaker_calibration_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE TABLE "speaker_calibration_attempt_segment" (
  "id" UUID NOT NULL,
  "speaker_calibration_attempt_id" UUID NOT NULL,
  "transcript_segment_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaker_calibration_attempt_segment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "speaker_calibration_attempt_segment_pair_key" UNIQUE ("speaker_calibration_attempt_id", "transcript_segment_id")
);
CREATE INDEX "speaker_calibration_membership_segment_idx" ON "speaker_calibration_attempt_segment"("transcript_segment_id");
ALTER TABLE "speaker_calibration_attempt_segment" ADD CONSTRAINT "speaker_calibration_membership_attempt_fkey" FOREIGN KEY ("speaker_calibration_attempt_id") REFERENCES "speaker_calibration_attempt"("id") ON DELETE CASCADE;
ALTER TABLE "speaker_calibration_attempt_segment" ADD CONSTRAINT "speaker_calibration_membership_segment_fkey" FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segment"("id") ON DELETE CASCADE;

CREATE FUNCTION enforce_speaker_calibration_membership_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "speaker_calibration_attempt" a
    JOIN "transcript_segment" t ON t."id" = NEW."transcript_segment_id"
    WHERE a."id" = NEW."speaker_calibration_attempt_id"
      AND a."session_id" = t."session_id"
      AND a."speaker_stream_id" = t."speaker_stream_id"
      AND t."start_ms" < COALESCE(a."end_timeline_ms", 2147483647)
      AND t."end_ms" > a."start_timeline_ms"
  ) THEN
    RAISE EXCEPTION 'speaker calibration membership is outside attempt scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "speaker_calibration_membership_scope"
AFTER INSERT OR UPDATE ON "speaker_calibration_attempt_segment"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION enforce_speaker_calibration_membership_scope();

CREATE FUNCTION enforce_speaker_calibration_attempt_facts() RETURNS trigger AS $$
DECLARE
  generation_offset INTEGER;
BEGIN
  SELECT g."timeline_offset_ms" INTO generation_offset
  FROM "session_capture_generation" g
  WHERE g."id" = NEW."capture_generation_id"
    AND g."session_id" = NEW."session_id"
    AND g."audio_stream_id" = NEW."audio_stream_id";
  IF generation_offset IS NULL
    OR NEW."start_timeline_ms" <> generation_offset + NEW."start_sequence_no" * 100
    OR (NEW."end_sequence_no" IS NOT NULL AND NEW."end_timeline_ms" <> generation_offset + NEW."end_sequence_no" * 100)
  THEN
    RAISE EXCEPTION 'speaker calibration boundary is not generation-derived' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "speaker_calibration_attempt_segment" m
    JOIN "transcript_segment" t ON t."id" = m."transcript_segment_id"
    WHERE m."speaker_calibration_attempt_id" = NEW."id"
      AND (t."session_id" <> NEW."session_id"
        OR t."speaker_stream_id" <> NEW."speaker_stream_id"
        OR t."start_ms" >= COALESCE(NEW."end_timeline_ms", 2147483647)
        OR t."end_ms" <= NEW."start_timeline_ms")
  ) THEN
    RAISE EXCEPTION 'speaker calibration attempt excludes persisted membership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "speaker_calibration_attempt_facts"
AFTER INSERT OR UPDATE ON "speaker_calibration_attempt"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION enforce_speaker_calibration_attempt_facts();
