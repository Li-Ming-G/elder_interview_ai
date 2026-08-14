ALTER TABLE "audit_log"
ADD CONSTRAINT "audit_log_anonymous_actor_shape_check"
CHECK (
  "actor_type" <> 'anonymous'
  OR (
    "actor_id" IS NULL
    AND "actor_reference" ~ '^auth_subject:v1:[0-9a-f]{64}$'
    AND "entity_type" = 'authentication'
    AND "entity_id" IS NULL
  )
);
