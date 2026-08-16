ALTER TABLE "decision_trace_p4_membership"
  ADD COLUMN IF NOT EXISTS "revision_status" VARCHAR(16) NOT NULL DEFAULT 'unavailable';
