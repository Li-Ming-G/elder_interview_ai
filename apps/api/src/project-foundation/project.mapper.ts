import type {
  ConsentResponse,
  InterviewSessionResponse,
  ProjectListOrdinaryProjection,
  ProjectListRestrictedProjection,
  ProjectResponse,
  ServiceTermResponse,
} from '@elder-interview/contracts';

import type {
  ConsentRecord,
  ElderProject,
  InterviewSession,
  SessionCaptureGeneration,
  SessionFinalization,
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

export function mapProjectListOrdinary(project: ElderProject): ProjectListOrdinaryProjection {
  if (project.status === 'restricted' || project.status === 'deleted') {
    throw new Error('Project is not ordinary');
  }
  return { ...mapProject(project), projection: 'ordinary', status: project.status };
}

export function mapProjectListRestricted(projectId: string): ProjectListRestrictedProjection {
  return {
    display_label: '受限项目',
    project_id: projectId,
    projection: 'restricted',
    status: 'restricted',
    status_label: '当前不可访问',
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
  return mapInterviewSessionSnapshot(session, null, 0);
}

export function mapInterviewSessionSnapshot(
  session: InterviewSession,
  finalization:
    | (SessionFinalization & {
        audioObject: {
          manifestChecksum: string | null;
          status: string;
          totalSizeBytes: bigint | null;
        };
      })
    | null,
  uploadedChunkCount: number,
  capture: SessionCaptureGeneration | null = null,
  captureUploadedChunkCount = 0,
): InterviewSessionResponse {
  return {
    capture:
      capture === null
        ? null
        : {
            audio_object_id: capture.audioObjectId,
            audio_stream_id: capture.audioStreamId,
            generation_no: capture.generationNo,
            interrupted_at: capture.interruptedAt?.toISOString() ?? null,
            interruption_reason: capture.interruptionReason,
            status: capture.status,
            timeline_offset_ms: capture.timelineOffsetMs,
            uploaded_chunk_count: captureUploadedChunkCount,
          },
    capture_failure_code: session.captureFailureCode,
    created_at: session.createdAt.toISOString(),
    created_by: session.createdBy,
    id: session.id,
    project_id: session.projectId,
    sequence_no: session.sequenceNo,
    started_at: session.startedAt?.toISOString() ?? null,
    ended_at: session.endedAt?.toISOString() ?? null,
    duration_seconds: session.durationSeconds,
    status: session.status,
    updated_at: session.updatedAt.toISOString(),
    finalization:
      finalization === null
        ? null
        : {
            audio_object_id: finalization.audioObjectId,
            completed_at: finalization.completedAt?.toISOString() ?? null,
            expected_chunk_count: finalization.expectedChunkCount,
            failure_code: finalization.failureCode as
              | 'AUDIO_COMMITMENT_CONFLICT'
              | 'AUDIO_MANIFEST_UNRECOVERABLE'
              | 'FINALIZATION_INTERNAL_FAILURE'
              | null,
            manifest_checksum:
              finalization.audioStatus === 'complete'
                ? finalization.audioObject.manifestChecksum
                : null,
            processing_started_at: finalization.processingStartedAt?.toISOString() ?? null,
            recording_status:
              capture?.status === 'interrupted' || session.status === 'interrupted'
                ? 'interrupted'
                : capture?.status === 'active' || session.status === 'recording'
                  ? 'recording'
                  : 'stopped',
            transcript_error_code: finalization.transcriptErrorCode as
              'ASR_UNAVAILABLE' | 'ASR_DRAIN_TIMEOUT' | 'ASR_DRAIN_INCOMPLETE' | null,
            transcript_status: finalization.transcriptStatus,
            total_size_bytes: mapFinalizationTotalSize(finalization),
            upload_status: finalization.audioStatus,
            uploaded_chunk_count: uploadedChunkCount,
          },
  };
}

function mapFinalizationTotalSize(
  finalization: SessionFinalization & {
    audioObject: { manifestChecksum: string | null; status: string; totalSizeBytes: bigint | null };
  },
): number | null {
  const bytes = finalization.audioObject.totalSizeBytes;
  if (
    finalization.audioStatus !== 'complete' ||
    finalization.audioObject.status !== 'complete' ||
    finalization.audioObject.manifestChecksum === null ||
    bytes === null ||
    bytes < 0n ||
    bytes > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return Number(bytes);
}
