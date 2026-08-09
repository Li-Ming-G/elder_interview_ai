export interface ApiErrorEnvelope {
  code: string;
  details: Record<string, unknown>;
  message: string;
  request_id: string;
}

export interface HealthResponse {
  database: 'up';
  status: 'ok';
  timestamp: string;
}

export type UserRole = 'interviewer' | 'admin' | 'data_admin';
export type UserStatus = 'active' | 'disabled';

export interface AuthUser {
  id: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  csrf_token: string;
}

export interface CsrfResponse {
  csrf_token: string;
}

export interface LogoutResponse {
  logged_out: true;
}

export type ProjectStatus = 'draft' | 'ready' | 'active' | 'completed' | 'restricted' | 'deleted';

export interface CreateProjectRequest {
  display_name: string;
  birth_year: number | null;
  approximate_age: number | null;
  native_place: string | null;
  current_city: string | null;
}

export interface ProjectResponse extends CreateProjectRequest {
  id: string;
  status: ProjectStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateServiceTermRequest {
  included_minutes: number;
  estimated_session_count: number;
  expected_current_minutes: number;
  overtime_unit_minutes: number;
  overtime_price_minor: number;
  currency: string;
}

export interface ServiceTermResponse extends CreateServiceTermRequest {
  id: string;
  project_id: string;
  explained_at: string;
  explained_by: string;
  effective_from: string;
  superseded_at: string | null;
  created_at: string;
}

export type ConsentType = 'recording_transcription_ai';
export type ConsentMethod = 'recorded_verbal' | 'electronic' | 'written';
export type ConsentStatus = 'pending' | 'valid' | 'revoked' | 'expired';

export interface CreateConsentRequest {
  consent_type: ConsentType;
  consent_text_version: string;
  consent_method: ConsentMethod;
  consented_at: string;
  consent_audio_object_id: string | null;
}

export interface ConsentResponse extends CreateConsentRequest {
  id: string;
  project_id: string;
  status: ConsentStatus;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
}

export interface IdempotentRequest {
  request_id: string;
}

export type InterviewSessionStatus =
  | 'created'
  | 'device_check'
  | 'recording'
  | 'reconnecting'
  | 'stopping'
  | 'processing'
  | 'completed'
  | 'interrupted'
  | 'failed';

export interface InterviewSessionResponse {
  id: string;
  project_id: string;
  sequence_no: number;
  status: InterviewSessionStatus;
  started_at: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  capture_failure_code?: 'NO_AUDIO_CAPTURED' | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  capture?: SessionCaptureSnapshot | null;
  finalization?: SessionFinalizationSnapshot | null;
}

export type CaptureGenerationStatus =
  'preparing' | 'active' | 'interrupted' | 'stopped' | 'abandoned_empty';

export type CaptureInterruptionReason =
  | 'capture_start_failed'
  | 'page_recovery_detected'
  | 'microphone_ended'
  | 'recorder_error'
  | 'local_archive_failed'
  | 'auth_lost'
  | 'unknown';

export interface SessionCaptureSnapshot {
  audio_object_id: string;
  generation_no: number;
  audio_stream_id: string;
  status: CaptureGenerationStatus;
  timeline_offset_ms: number;
  uploaded_chunk_count: number;
  interruption_reason: CaptureInterruptionReason | null;
  interrupted_at: string | null;
}

export type FinalizationUploadStatus =
  'awaiting_upload' | 'verifying' | 'complete' | 'unrecoverable';
export type FinalizationTranscriptStatus =
  'pending' | 'draining' | 'drained' | 'degraded' | 'not_started';
export interface SessionFinalizationSnapshot {
  audio_object_id: string;
  expected_chunk_count: number;
  recording_status: 'recording' | 'stopped' | 'interrupted';
  upload_status: FinalizationUploadStatus;
  uploaded_chunk_count: number;
  manifest_checksum: string | null;
  transcript_status: FinalizationTranscriptStatus;
  transcript_error_code: 'ASR_UNAVAILABLE' | 'ASR_DRAIN_TIMEOUT' | 'ASR_DRAIN_INCOMPLETE' | null;
  failure_code:
    | 'AUDIO_COMMITMENT_CONFLICT'
    | 'AUDIO_MANIFEST_UNRECOVERABLE'
    | 'FINALIZATION_INTERNAL_FAILURE'
    | null;
  processing_started_at: string | null;
  completed_at: string | null;
}

export interface SessionChunkCommitment {
  sequence_no: number;
  start_ms: number;
  end_ms: number;
  size_bytes: number;
  checksum: string;
  mime_type: string;
}
export interface StopSessionRequest extends IdempotentRequest {
  audio_object_id: string;
  expected_chunk_count: number;
  chunks: SessionChunkCommitment[];
}
export interface StartSessionRequest extends IdempotentRequest {
  mime_type: string;
  audio_stream_id: string;
}

export interface ConfirmCaptureActiveRequest extends IdempotentRequest {
  generation_no: number;
  audio_stream_id: string;
}

export interface ReportCaptureInterruptedRequest extends ConfirmCaptureActiveRequest {
  reason: CaptureInterruptionReason;
}

export interface AbandonEmptyCaptureRequest extends ConfirmCaptureActiveRequest {
  local_archive_chunk_count: 0;
}

export interface ResumeCaptureRequest extends IdempotentRequest {
  action: 'resume_capture';
  audio_stream_id: string;
  local_archive_chunk_count: number;
  local_archive_timeline_high_water_ms: number;
}

export type RecoverSessionRequest =
  | (IdempotentRequest & { action: 'reconcile' })
  | ResumeCaptureRequest
  | (StopSessionRequest & { action: 'finalize_interrupted' });

export interface DeviceCheckRequest {
  microphone_permission: 'granted' | 'denied';
  input_detected: boolean;
}

export type AudioPurpose = 'consent' | 'interview';
export type AudioObjectStatus = 'initiated' | 'uploading' | 'complete' | 'failed';

export interface CreateAudioObjectRequest extends IdempotentRequest {
  purpose: AudioPurpose;
  session_id: string | null;
  mime_type: string;
}

export interface AudioObjectResponse {
  id: string;
  project_id: string;
  session_id: string | null;
  purpose: AudioPurpose;
  status: AudioObjectStatus;
  mime_type: string;
  created_by: string;
  created_at: string;
}

export interface CompleteAudioObjectRequest extends IdempotentRequest {
  expected_chunk_count: number;
}

export interface AudioChunkResponse {
  id: string;
  audio_object_id: string;
  sequence_no: number;
  start_ms: number;
  end_ms: number;
  size_bytes: number;
  checksum: string;
  mime_type: string;
  upload_status: 'uploaded';
  uploaded_at: string;
}

export interface AudioManifestChunk {
  sequence_no: number;
  start_ms: number;
  end_ms: number;
  size_bytes: number;
  checksum: string;
  mime_type: string;
  uploaded_at: string;
}

export interface AudioManifestResponse extends AudioObjectResponse {
  chunk_count: number | null;
  total_size_bytes: number | null;
  manifest_checksum: string | null;
  completed_at: string | null;
  chunks: AudioManifestChunk[];
}

export type SpeakerCalibrationStatus =
  'not_started' | 'collecting' | 'confirmed' | 'failed' | 'skipped';

export interface SpeakerCalibrationMapping {
  speaker_provider_id: string;
  speaker_role: 'elder' | 'interviewer';
  authority: 'user_confirmed';
}

export interface SpeakerCalibrationSnapshot {
  session_id: string;
  speaker_role_revision: number;
  status: SpeakerCalibrationStatus;
  speaker_stream: {
    id: string;
    capture_generation_id: string;
    audio_stream_id: string;
    status: 'active';
  } | null;
  attempt: {
    id: string;
    attempt_no: number;
    status: Exclude<SpeakerCalibrationStatus, 'not_started'>;
    boundary: {
      start_sequence_no: number;
      end_sequence_no_exclusive: number | null;
      start_timeline_ms: number;
      end_timeline_ms: number | null;
    };
    observed_provider_labels: string[];
    confirmed_mappings: SpeakerCalibrationMapping[];
    started_at: string;
    resolved_at: string | null;
  } | null;
  updated_at: string;
}

export interface BeginSpeakerCalibrationRequest extends IdempotentRequest {
  speaker_stream_id: string;
}

export interface ResolveSpeakerCalibrationRequest extends IdempotentRequest {
  action: 'confirm' | 'fail' | 'skip';
  mappings: Array<{
    speaker_provider_id: string;
    speaker_role: 'elder' | 'interviewer';
  }>;
}

export const INTERVIEW_WS_PATH = '/ws/interviews';
export const INTERVIEW_WS_SCHEMA_VERSION = '1.1';
export const INTERVIEW_WS_MAX_MESSAGE_BYTES = 8192;
export const INTERVIEW_PCM_FRAME_BYTES = 3200;
export const INTERVIEW_PCM_FRAME_DURATION_MS = 100;
export const INTERVIEW_PCM_SAMPLE_COUNT = 1600;
export const INTERVIEW_PCM_SAMPLE_RATE_HZ = 16_000;

export type InterviewWsClientType = 'audio.frame' | 'event.ack' | 'heartbeat' | 'session.join';
export type InterviewWsServerType =
  | 'asr.final'
  | 'asr.interim'
  | 'asr.status'
  | 'audio.ack'
  | 'error'
  | 'heartbeat.ack'
  | 'speaker.calibration.updated'
  | 'session.ready';

export interface InterviewWsClientEnvelope<TType extends InterviewWsClientType, TPayload> {
  type: TType;
  event_id: string;
  session_id: string;
  schema_version: typeof INTERVIEW_WS_SCHEMA_VERSION;
  payload: TPayload;
}

export interface InterviewWsJoinPayload {
  csrf_token: string;
  audio_stream_id: string;
  event_stream_id?: string;
  resume_after_server_sequence?: number;
}

export interface InterviewWsAudioFramePayload {
  audio_stream_id: string;
  sequence_no: number;
  start_ms: number;
  end_ms: number;
  encoding: 'pcm_s16le';
  sample_rate_hz: 16000;
  channels: 1;
  sample_count: 1600;
  pcm_sha256: string;
  pcm_base64: string;
}

export interface InterviewWsEventAckPayload {
  server_sequence: number;
}

export type InterviewWsHeartbeatPayload = Record<string, never>;

export type InterviewWsClientMessage =
  | InterviewWsClientEnvelope<'audio.frame', InterviewWsAudioFramePayload>
  | InterviewWsClientEnvelope<'event.ack', InterviewWsEventAckPayload>
  | InterviewWsClientEnvelope<'heartbeat', InterviewWsHeartbeatPayload>
  | InterviewWsClientEnvelope<'session.join', InterviewWsJoinPayload>;

export interface InterviewWsServerEnvelope<TType extends InterviewWsServerType, TPayload> {
  type: TType;
  event_id: string;
  event_stream_id: string;
  server_sequence: number;
  session_id: string;
  timestamp: string;
  schema_version: typeof INTERVIEW_WS_SCHEMA_VERSION;
  payload: TPayload;
}

export interface InterviewWsSessionReadyPayload {
  audio_stream_id: string;
  speaker_calibration: SpeakerCalibrationSnapshot;
  resumed: boolean;
  highest_audio_sequence_acked: number;
  resume_window_seconds: 300;
  resume_window_events: 512;
}

export interface InterviewWsAudioAckPayload {
  audio_stream_id: string;
  highest_audio_sequence_acked: number;
}

export interface InterviewWsAsrInterimPayload {
  hypothesis_id: string;
  revision: number;
  start_ms: number;
  end_ms: number;
  text: string;
  finality: 'interim';
}

export interface InterviewWsAsrFinalPayload {
  segment_id: string;
  speaker_provider_id: string | null;
  speaker_role: 'elder' | 'interviewer' | 'unknown';
  speaker_role_authority: 'unconfirmed' | 'user_confirmed';
  speaker_stream_id: string;
  speaker_role_revision: number;
  content_kind: 'conversation' | 'speaker_calibration';
  start_ms: number;
  end_ms: number;
  text: string;
  finality: 'final';
}

export interface InterviewWsAsrStatusPayload {
  status: 'connected' | 'unavailable';
  code?: 'ASR_UNAVAILABLE';
}

export interface InterviewWsErrorPayload {
  code: string;
  reset_required?: boolean;
}
