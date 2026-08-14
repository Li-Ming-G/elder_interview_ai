-- Speaker identities are scoped to a provider namespace / speaker stream.
-- The stream-scoped replacement was added in 20260809190000, but the legacy
-- session-wide partial unique index remained and rejected valid reconnects
-- when a provider reused labels such as speaker_1 on the new stream.
DROP INDEX IF EXISTS "speaker_mapping_current_key";
