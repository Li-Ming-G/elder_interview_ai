import type {
  CreateConsentRequest,
  CreateProjectRequest,
  CreateServiceTermRequest,
  DeviceCheckRequest,
  IdempotentRequest,
} from '@elder-interview/contracts';
import { UnprocessableEntityException } from '@nestjs/common';

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
