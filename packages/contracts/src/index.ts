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
  created_by: string;
  created_at: string;
  updated_at: string;
}

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

export const INTERVIEW_WS_PATH = '/ws/interviews';
export const INTERVIEW_WS_SCHEMA_VERSION = '1.0';
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
