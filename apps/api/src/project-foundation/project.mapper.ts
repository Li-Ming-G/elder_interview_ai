import type {
  ConsentResponse,
  InterviewSessionResponse,
  ProjectResponse,
  ServiceTermResponse,
} from '@elder-interview/contracts';

import type {
  ConsentRecord,
  ElderProject,
  InterviewSession,
  ServiceTerm,
} from '../generated/prisma/client.js';

export function mapProject(project: ElderProject): ProjectResponse {
  return {
    approximate_age: project.approximateAge,
    birth_year: project.birthYear,
    created_at: project.createdAt.toISOString(),
    created_by: project.createdBy,
    current_city: project.currentCity,
    display_name: project.displayName ?? '',
    id: project.id,
    native_place: project.nativePlace,
    status: project.status,
    updated_at: project.updatedAt.toISOString(),
  };
}

export function mapServiceTerm(term: ServiceTerm): ServiceTermResponse {
  return {
    created_at: term.createdAt.toISOString(),
    currency: term.currency,
    effective_from: term.effectiveFrom.toISOString(),
    estimated_session_count: term.estimatedSessionCount,
    expected_current_minutes: term.expectedCurrentMinutes,
    explained_at: term.explainedAt.toISOString(),
    explained_by: term.explainedBy,
    id: term.id,
    included_minutes: term.includedMinutes,
    overtime_price_minor: term.overtimePriceMinor,
    overtime_unit_minutes: term.overtimeUnitMinutes,
    project_id: term.projectId,
    superseded_at: term.supersededAt?.toISOString() ?? null,
  };
}

export function mapConsent(consent: ConsentRecord): ConsentResponse {
  return {
    consent_audio_object_id: consent.consentAudioObjectId,
    consent_method: consent.consentMethod,
    consent_text_version: consent.consentTextVersion,
    consent_type: consent.consentType,
    consented_at: consent.consentedAt.toISOString(),
    created_at: consent.createdAt.toISOString(),
    created_by: consent.createdBy,
    id: consent.id,
    project_id: consent.projectId,
    revoked_at: consent.revokedAt?.toISOString() ?? null,
    status: consent.status,
  };
}

export function mapInterviewSession(session: InterviewSession): InterviewSessionResponse {
  return {
    created_at: session.createdAt.toISOString(),
    created_by: session.createdBy,
    id: session.id,
    project_id: session.projectId,
    sequence_no: session.sequenceNo,
    started_at: session.startedAt?.toISOString() ?? null,
    status: session.status,
    updated_at: session.updatedAt.toISOString(),
  };
}
