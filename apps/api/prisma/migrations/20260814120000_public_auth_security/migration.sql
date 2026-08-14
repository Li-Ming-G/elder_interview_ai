-- Extend the append-only audit actor vocabulary for pre-authentication security events.
-- Existing user and system_operator history remains unchanged.
ALTER TYPE "AuditActorType" ADD VALUE IF NOT EXISTS 'anonymous';
