import type {
  CreateConsentRequest,
  CreateProjectRequest,
  CreateServiceTermRequest,
  DeviceCheckRequest,
  StartSessionRequest,
  ConfirmCaptureActiveRequest,
  ReportCaptureInterruptedRequest,
  AbandonEmptyCaptureRequest,
  IdempotentRequest,
  RecoverSessionRequest,
  StopSessionRequest,
} from '@elder-interview/contracts';
import { UnprocessableEntityException } from '@nestjs/common';

import { validateMimeType } from '../audio/audio.validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw validationError();
  return value;
}

export function validateCreateProject(body: Record<string, unknown>): CreateProjectRequest {
  return {
    approximate_age: nullableInteger(body.approximate_age),
    birth_year: nullableInteger(body.birth_year),
    current_city: nullableText(body.current_city, 200),
    display_name: requiredText(body.display_name, 120),
    native_place: nullableText(body.native_place, 200),
  };
}

export function validateServiceTerm(body: Record<string, unknown>): CreateServiceTermRequest {
  const currency = body.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw validationError();
  return {
    currency,
    estimated_session_count: nonnegativeInteger(body.estimated_session_count),
    expected_current_minutes: nonnegativeInteger(body.expected_current_minutes),
    included_minutes: nonnegativeInteger(body.included_minutes),
    overtime_price_minor: nonnegativeInteger(body.overtime_price_minor),
    overtime_unit_minutes: nonnegativeInteger(body.overtime_unit_minutes),
  };
}

export function validateConsent(body: Record<string, unknown>): CreateConsentRequest {
  if (body.consent_type !== 'recording_transcription_ai') throw validationError();
  if (!['recorded_verbal', 'electronic', 'written'].includes(String(body.consent_method))) {
    throw validationError();
  }
  const consentMethod = body.consent_method as CreateConsentRequest['consent_method'];
  const consentAudioObjectId =
    body.consent_audio_object_id === null ? null : validateUuid(body.consent_audio_object_id);
  if (
    (consentMethod === 'recorded_verbal' && consentAudioObjectId === null) ||
    (consentMethod !== 'recorded_verbal' && consentAudioObjectId !== null)
  ) {
    throw validationError();
  }
  const consentedAt = body.consented_at;
  if (typeof consentedAt !== 'string' || !Number.isFinite(Date.parse(consentedAt))) {
    throw validationError();
  }
  return {
    consent_audio_object_id: consentAudioObjectId,
    consent_method: consentMethod,
    consent_text_version: requiredText(body.consent_text_version, 80),
    consent_type: 'recording_transcription_ai',
    consented_at: new Date(consentedAt).toISOString(),
  };
}

export function validateIdempotentRequest(body: Record<string, unknown>): IdempotentRequest {
  return { request_id: validateUuid(body.request_id) };
}

export function validateStartSession(body: Record<string, unknown>): StartSessionRequest {
  return {
    audio_stream_id: validateUuid(body.audio_stream_id),
    mime_type: validateMimeType(body.mime_type),
    request_id: validateUuid(body.request_id),
  };
}

export function validateConfirmCaptureActive(
  body: Record<string, unknown>,
): ConfirmCaptureActiveRequest {
  return {
    audio_stream_id: validateUuid(body.audio_stream_id),
    generation_no: nonnegativeInteger(body.generation_no),
    request_id: validateUuid(body.request_id),
  };
}

export function validateReportCaptureInterrupted(
  body: Record<string, unknown>,
): ReportCaptureInterruptedRequest {
  const input = validateConfirmCaptureActive(body);
  const reasons = [
    'capture_start_failed',
    'page_recovery_detected',
    'microphone_ended',
    'recorder_error',
    'local_archive_failed',
    'auth_lost',
    'unknown',
  ] as const;
  if (!reasons.includes(body.reason as (typeof reasons)[number])) throw validationError();
  return { ...input, reason: body.reason as ReportCaptureInterruptedRequest['reason'] };
}

export function validateAbandonEmptyCapture(
  body: Record<string, unknown>,
): AbandonEmptyCaptureRequest {
  const input = validateConfirmCaptureActive(body);
  if (body.local_archive_chunk_count !== 0) throw validationError();
  return { ...input, local_archive_chunk_count: 0 };
}

export function validateDeviceCheck(body: Record<string, unknown>): DeviceCheckRequest {
  if (
    !['granted', 'denied'].includes(String(body.microphone_permission)) ||
    typeof body.input_detected !== 'boolean'
  ) {
    throw validationError();
  }
  return {
    input_detected: body.input_detected,
    microphone_permission: body.microphone_permission as 'granted' | 'denied',
  };
}

export function validateStopSession(body: Record<string, unknown>): StopSessionRequest {
  if (!Array.isArray(body.chunks)) throw validationError();
  return {
    audio_object_id: validateUuid(body.audio_object_id),
    chunks: body.chunks.map((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw validationError();
      const chunk = value as Record<string, unknown>;
      if (typeof chunk.checksum !== 'string' || typeof chunk.mime_type !== 'string')
        throw validationError();
      return {
        checksum: chunk.checksum,
        end_ms: nonnegativeInteger(chunk.end_ms),
        mime_type: chunk.mime_type,
        sequence_no: nonnegativeInteger(chunk.sequence_no),
        size_bytes: nonnegativeInteger(chunk.size_bytes),
        start_ms: nonnegativeInteger(chunk.start_ms),
      };
    }),
    expected_chunk_count: nonnegativeInteger(body.expected_chunk_count),
    request_id: validateUuid(body.request_id),
  };
}

export function validateRecoverSession(body: Record<string, unknown>): RecoverSessionRequest {
  if (!['reconcile', 'resume_capture', 'finalize_interrupted'].includes(String(body.action)))
    throw validationError();
  if (body.action === 'finalize_interrupted')
    return { ...validateStopSession(body), action: 'finalize_interrupted' };
  if (body.action === 'resume_capture') {
    return {
      action: 'resume_capture',
      audio_stream_id: validateUuid(body.audio_stream_id),
      local_archive_chunk_count: nonnegativeInteger(body.local_archive_chunk_count),
      local_archive_timeline_high_water_ms: nonnegativeInteger(
        body.local_archive_timeline_high_water_ms,
      ),
      request_id: validateUuid(body.request_id),
    };
  }
  return { action: 'reconcile', request_id: validateUuid(body.request_id) };
}

function requiredText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') throw validationError();
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) throw validationError();
  return text;
}

function nullableText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return requiredText(value, maxLength);
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return nonnegativeInteger(value);
}

function nonnegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw validationError();
  }
  return value;
}

function validationError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'VALIDATION_ERROR',
    details: {},
    message: 'Request validation failed',
  });
}
