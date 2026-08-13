ALTER TABLE "idempotency_record"
  ALTER COLUMN "target_id" DROP NOT NULL,
  ADD COLUMN "create_identity" VARCHAR(240),
  ADD COLUMN "request_payload_hash" VARCHAR(64);

ALTER TABLE "idempotency_record"
  ADD CONSTRAINT "idempotency_record_target_identity_check"
  CHECK (
    ("target_id" IS NOT NULL AND "create_identity" IS NULL)
    OR ("target_id" IS NULL AND "create_identity" IS NOT NULL)
  ) NOT VALID;

COMMENT ON CONSTRAINT "idempotency_record_target_identity_check" ON "idempotency_record" IS
  'Legacy rows are allowed until separately backfilled; new writes must bind exactly one target identity.';
