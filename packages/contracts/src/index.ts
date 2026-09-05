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

export interface ProjectDetails {
  display_name: string;
  birth_year: number | null;
  approximate_age: number | null;
  native_place: string | null;
  current_city: string | null;
}

export interface CreateProjectRequest extends ProjectDetails, IdempotentRequest {}

export interface DiscardPrestartInterviewRequest extends IdempotentRequest {
  session_id: string | null;
  workflow_version: 'prestart-discard-v1';
}

export type PrestartDiscardResult = 'discarded' | 'already_discarded';

export interface DiscardPrestartInterviewResponse {
  project_id: string;
  request_id: string;
  result: PrestartDiscardResult;
  session_id: string | null;
}

export interface ProjectResponse extends ProjectDetails {
  id: string;
  status: ProjectStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectListOrdinaryProjection extends Omit<ProjectResponse, 'status'> {
  projection: 'ordinary';
  status: Exclude<ProjectStatus, 'restricted' | 'deleted'>;
  /**
   * SPEC-REPEAT-INTERVIEW-001 contract-first seam. Absence is fail-closed
   * during rollout. DEV-008B1 must emit this key for every ordinary row before
   * the Home UI may render the project-level next-session action.
   */
  repeat_interview?: RepeatInterviewProjectActionProjection;
}

export type RepeatInterviewActionReason =
  | 'eligible'
  | 'no_completed_session'
  | 'session_in_progress'
  | 'project_unavailable'
  | 'consent_reauthorization_required'
  | 'consent_unavailable'
  | 'access_unavailable';

export type ConsentContinuationStatus = 'covered' | 'reauthorization_required' | 'unavailable';

export type ConsentContinuationReauthorizationReason =
  | 'consent_missing'
  | 'consent_revoked'
  | 'consent_expired'
  | 'consent_text_version_incompatible'
  | 'processing_purpose_expanded'
  | 'access_scope_expanded'
  | 'provider_processing_region_expanded'
  | 'public_or_training_use_expanded'
  | 'future_interviews_not_covered';

export type ConsentContinuationReason =
  | 'same_project_planned_interviews_covered'
  | ConsentContinuationReauthorizationReason
  | 'policy_unavailable';

interface ConsentContinuationProjectionBase {
  workflow_version: 'continuing-consent-v1';
}

export interface ConsentContinuationCoveredProjection extends ConsentContinuationProjectionBase {
  status: 'covered';
  reason: 'same_project_planned_interviews_covered';
  basis_consent_record_id: string;
  basis_consent_text_version: string;
  required_consent_text_version: string;
  required_action: 'show_recording_reminder';
}

export interface ConsentContinuationMissingProjection extends ConsentContinuationProjectionBase {
  status: 'reauthorization_required';
  reason: 'consent_missing';
  basis_consent_record_id: null;
  basis_consent_text_version: null;
  required_consent_text_version: string;
  required_action: 'record_formal_consent';
}

export interface ConsentContinuationExistingRecordReauthorizationProjection extends ConsentContinuationProjectionBase {
  status: 'reauthorization_required';
  reason: Exclude<ConsentContinuationReauthorizationReason, 'consent_missing'>;
  basis_consent_record_id: string;
  basis_consent_text_version: string;
  required_consent_text_version: string;
  required_action: 'record_formal_consent';
}

export interface ConsentContinuationUnavailableProjection extends ConsentContinuationProjectionBase {
  status: 'unavailable';
  reason: 'policy_unavailable';
  basis_consent_record_id: null;
  basis_consent_text_version: null;
  required_consent_text_version: null;
  required_action: null;
}

export type ConsentContinuationReauthorizationProjection =
  ConsentContinuationMissingProjection | ConsentContinuationExistingRecordReauthorizationProjection;

export type ConsentContinuationProjection =
  | ConsentContinuationCoveredProjection
  | ConsentContinuationReauthorizationProjection
  | ConsentContinuationUnavailableProjection;

interface RepeatInterviewProjectActionProjectionBase {
  workflow_version: 'repeat-interview-v1';
}

export interface RepeatInterviewEligibleProjection extends RepeatInterviewProjectActionProjectionBase {
  primary_action: 'start_next_session';
  reason: 'eligible';
  basis_session_id: string;
  basis_sequence_no: number;
  next_sequence_no: number;
  consent_continuation: ConsentContinuationCoveredProjection;
}

export interface RepeatInterviewSessionBlockedProjection extends RepeatInterviewProjectActionProjectionBase {
  primary_action: null;
  reason: 'no_completed_session' | 'session_in_progress';
  basis_session_id: null;
  basis_sequence_no: null;
  next_sequence_no: null;
  consent_continuation: ConsentContinuationProjection;
}

export interface RepeatInterviewProjectOrAccessUnavailableProjection extends RepeatInterviewProjectActionProjectionBase {
  primary_action: null;
  reason: 'project_unavailable' | 'access_unavailable';
  basis_session_id: null;
  basis_sequence_no: null;
  next_sequence_no: null;
  consent_continuation: null;
}

export interface RepeatInterviewConsentUnavailableProjection extends RepeatInterviewProjectActionProjectionBase {
  primary_action: null;
  reason: 'consent_unavailable';
  basis_session_id: null;
  basis_sequence_no: null;
  next_sequence_no: null;
  consent_continuation: ConsentContinuationUnavailableProjection;
}

export interface RepeatInterviewConsentReauthorizationProjection extends RepeatInterviewProjectActionProjectionBase {
  primary_action: 'record_formal_consent';
  reason: 'consent_reauthorization_required';
  basis_session_id: null;
  basis_sequence_no: null;
  next_sequence_no: null;
  consent_continuation: ConsentContinuationReauthorizationProjection;
}

/**
 * If this rollout seam is present, its discriminants and consent projection
 * are complete. The outer ProjectListOrdinaryProjection.repeat_interview key
 * remains optional until DEV-008B1; absence is fail-closed.
 */
export type RepeatInterviewProjectActionProjection =
  | RepeatInterviewEligibleProjection
  | RepeatInterviewSessionBlockedProjection
  | RepeatInterviewProjectOrAccessUnavailableProjection
  | RepeatInterviewConsentUnavailableProjection
  | RepeatInterviewConsentReauthorizationProjection;

export interface ProjectListRestrictedProjection {
  project_id: string;
  projection: 'restricted';
  status: 'restricted';
  display_label: '受限项目';
  status_label: '当前不可访问';
}

export type ProjectListProjection = ProjectListOrdinaryProjection | ProjectListRestrictedProjection;

export interface ProjectListResponse {
  items: ProjectListProjection[];
}

export interface ServiceTermDetails {
  included_minutes: number;
  estimated_session_count: number;
  expected_current_minutes: number;
  overtime_unit_minutes: number;
  overtime_price_minor: number;
  currency: string;
}

export interface CreateServiceTermRequest extends ServiceTermDetails, IdempotentRequest {}

export interface ServiceTermResponse extends ServiceTermDetails {
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

export interface ConsentDetails {
  consent_type: ConsentType;
  consent_text_version: string;
  consent_method: ConsentMethod;
  consented_at: string;
  consent_audio_object_id: string | null;
}

export interface CreateConsentRequest extends ConsentDetails, IdempotentRequest {}

export interface ConsentResponse extends ConsentDetails {
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

export interface CreateNextSessionRequest extends IdempotentRequest {
  basis_session_id: string;
  expected_basis_sequence_no: number;
  workflow_version: 'repeat-interview-v1';
}

export interface CreateNextSessionResponse {
  request_id: string;
  project_id: string;
  basis_session_id: string;
  basis_sequence_no: number;
  session: InterviewSessionResponse;
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
  /**
   * Server-owned notice shown verbatim before every formal recording start.
   * Absence is fail-closed once the continuing-consent workflow is enabled.
   */
  recording_start_reminder?: RecordingStartReminderProjection;
}

export const RECORDING_START_REMINDER_VERSION = 'recording-reminder-v1' as const;
export const RECORDING_START_REMINDER_TEXT =
  '本次仍会录音、转录并由 AI 辅助分析；长者可随时要求停止或撤回。' as const;

export interface RecordingStartReminderProjection {
  version: typeof RECORDING_START_REMINDER_VERSION;
  text: typeof RECORDING_START_REMINDER_TEXT;
  action_label: '开始访谈';
  requires_explicit_action: true;
  creates_consent_record: false;
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
  /**
   * Additive contract-first field. A3's ordinary canonical session mapper must
   * emit this key explicitly: null until the linked audio object is proven
   * complete, otherwise the exact safe-integer AudioObject.totalSizeBytes.
   */
  total_size_bytes?: number | null;
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

export type SessionHomeState =
  | 'preparation_required'
  | 'interview_active'
  | 'interview_interrupted'
  | 'saving_audio'
  | 'transcript_processing'
  | 'review_ready'
  | 'no_audio_captured'
  | 'saved_with_warning'
  | 'save_failed';

export type SessionPrimaryAction =
  | 'continue_preparation'
  | 'return_to_interview'
  | 'resolve_interruption'
  | 'view_save_progress'
  | 'view_review'
  | 'view_save_facts';

export type SessionReviewAccess = 'unavailable' | 'read_only';

export type PostSessionAnalysisLaneStatus =
  | 'not_started'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'unjudged'
  | 'failed'
  | 'cancelled'
  | 'unavailable';

export interface PostSessionAnalysisLaneProjection {
  status: PostSessionAnalysisLaneStatus;
  job_id: string | null;
  request_id: string | null;
  attempt_no: number;
  retryable: boolean;
  error_code: string | null;
  updated_at: string | null;
}

export interface PostSessionAnalysisProjection {
  trigger_identity: string;
  memory_extract: PostSessionAnalysisLaneProjection;
  actual_question_reconcile: PostSessionAnalysisLaneProjection;
}

export type SecondSessionOpeningStatus =
  | 'waiting_calibration'
  | 'waiting_basis_analysis'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unavailable';

export interface SecondSessionOpeningProjection {
  status: SecondSessionOpeningStatus;
  basis_session_id: string;
  basis_analysis_trigger_identity: string;
  calibration_gate_identity: string | null;
  request_id: string | null;
  attempt_id: string | null;
  error_code: string | null;
  updated_at: string;
}

export interface ProjectSessionListItem {
  id: string;
  project_id: string;
  sequence_no: number;
  status: InterviewSessionStatus;
  capture_failure_code: 'NO_AUDIO_CAPTURED' | null;
  capture: Pick<SessionCaptureSnapshot, 'status'> | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  finalization: Pick<
    SessionFinalizationSnapshot,
    | 'recording_status'
    | 'upload_status'
    | 'transcript_status'
    | 'failure_code'
    | 'manifest_checksum'
  > | null;
  home_state: SessionHomeState;
  primary_action: SessionPrimaryAction;
  review_access: SessionReviewAccess;
  /**
   * Contract-first, content-free status/retry evidence. Absence means the
   * runtime has not implemented the projection and must not be treated as a
   * successful inheritance analysis.
   */
  post_session_analysis?: PostSessionAnalysisProjection | null;
  /**
   * Derived, content-free coordination state. Waiting states never imply that
   * a generation attempt exists or that the exact-once opening gate has been
   * consumed.
   */
  second_session_opening?: SecondSessionOpeningProjection | null;
}

export interface ProjectSessionListResponse {
  items: ProjectSessionListItem[];
  next_cursor: string | null;
}

export interface EvidenceFinalizationResponse {
  session_id: string;
  audio_object_id: string;
  session_status: Extract<
    InterviewSessionStatus,
    'stopping' | 'processing' | 'completed' | 'failed'
  >;
  expected_chunk_count: number;
  recording_status: SessionFinalizationSnapshot['recording_status'];
  upload_status: SessionFinalizationSnapshot['upload_status'];
  uploaded_chunk_count: number;
  manifest_checksum: string | null;
  failure_code: SessionFinalizationSnapshot['failure_code'];
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
  /** Contract-first rollout seam; DEV-008B1 runtime must require this field. */
  recording_reminder_version?: typeof RECORDING_START_REMINDER_VERSION;
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
export const SUGGESTION_WS_SCHEMA_VERSION = '1.2';
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
  | 'suggestion.presentation.changed'
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
  schema_version: typeof INTERVIEW_WS_SCHEMA_VERSION | typeof SUGGESTION_WS_SCHEMA_VERSION;
  payload: TPayload;
}

export type SuggestionPresentationKind =
  'suggestion' | 'continue_listening' | 'unavailable' | 'withdrawn';

export type SuggestionWithdrawalReason =
  | 'restricted'
  | 'do_not_ask'
  | 'deletion_active'
  | 'consent_revoked'
  | 'access_revoked'
  | 'policy_unavailable';

export type AutomaticQuestionAttemptOutcome = 'succeeded' | 'in_flight' | 'failed';

export type AutomaticQuestionFailureCode =
  | 'AI_UNAVAILABLE'
  | 'AI_CONTEXT_SCHEMA_INVALID'
  | 'AI_EVIDENCE_OUTSIDE_FROZEN_INPUT'
  | 'AI_JOB_CANCELLED'
  | 'AI_JOB_NOT_RUNNING'
  | 'AI_OUTPUT_REFERENCE_OUTSIDE_CONTEXT'
  | 'AI_OUTPUT_SCHEMA_INVALID'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_REQUEST_IDENTITY_CONFLICT'
  | 'AI_SESSION_SCOPE_INVALID'
  | 'CONTEXT_BUILD_FAILED'
  | 'DIRECTOR_FAILED'
  | 'EVIDENCE_TIMEOUT'
  | 'MEMORY_TRIGGER_PROVENANCE_UNAVAILABLE'
  | 'MEMORY_TRACE_PROVENANCE_UNAVAILABLE'
  | 'MEMORY_UNJUDGED'
  | 'MEMORY_UNJUDGED_JOB_DRIFT'
  | 'PROVIDER_FAILED'
  | 'QUESTION_PREPARATION_FAILED'
  | 'SYSTEM_COORDINATOR_RESTARTED'
  | 'SYSTEM_REJECTION_FAILED'
  | 'TEST_CONTEXT_ATTACHMENT_FAILED'
  | 'WRITEBACK_FAILED';

export type AutomaticQuestionWaitingReason = 'minimum_interval' | 'new_conversation' | 'debounce';

export interface AutomaticQuestionGenerationStatus {
  latest_attempt: {
    attempt_id: string;
    outcome: AutomaticQuestionAttemptOutcome;
    failure_code: AutomaticQuestionFailureCode | null;
    completed_at: string | null;
  } | null;
  waiting: {
    reason: AutomaticQuestionWaitingReason;
    next_attempt_at: string | null;
  } | null;
}

export interface SuggestionHistorySummary {
  has_previous: boolean;
}

export interface SuggestionPresentationResponse {
  session_id: string;
  presentation_revision: number;
  kind: SuggestionPresentationKind;
  snapshot_id: string | null;
  display_sequence: number | null;
  question: string | null;
  reason: string | null;
  displayed_at: string | null;
  withdrawal_reason: SuggestionWithdrawalReason | null;
  history: SuggestionHistorySummary;
  /** Additive server-authoritative status for automatic AI assistance. */
  ai_status?: AutomaticQuestionGenerationStatus;
}

export interface SuggestionHistoryItem {
  snapshot_id: string;
  display_sequence: number;
  question: string | null;
  reason: string | null;
  displayed_at: string;
  kind: 'suggestion' | 'withdrawn';
  withdrawal_reason: SuggestionWithdrawalReason | null;
  older_cursor: string | null;
  newer_cursor: string | null;
}

export interface SuggestionHistoryPageResponse {
  session_id: string;
  items: SuggestionHistoryItem[];
  next_cursor: string | null;
  anchor: string;
}

export interface SuggestionHistoryItemResponse {
  session_id: string;
  anchor: string;
  item: SuggestionHistoryItem;
}

export interface ManualNextSuggestionRequest extends IdempotentRequest {
  expected_presentation_revision: number;
  expected_snapshot_id: string | null;
}

export interface SuggestionRequestAcceptedResponse {
  request_id: string;
  attempt_id: string;
  status: 'pending' | 'running';
  accepted_presentation_revision: number;
  retry_after_ms: number;
}

export interface SuggestionRequestStatusResponse {
  request_id: string;
  attempt_id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result_kind: 'suggestion' | 'continue_listening' | 'unavailable' | null;
  publication_outcome:
    | 'published'
    | 'not_better'
    | 'duplicate_filtered'
    | 'stale_basis'
    | 'superseded_by_manual'
    | 'policy_blocked'
    | 'not_applicable'
    | null;
  error_code: string | null;
  current: SuggestionPresentationResponse;
}

export interface SuggestionPresentationChangedPayload {
  presentation_revision: number;
  kind: SuggestionPresentationKind;
  snapshot_id: string | null;
  change_kind: 'initial_display' | 'automatic_replace' | 'manual_next' | 'hard_withdrawal';
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
  content_kind: 'conversation' | 'speaker_calibration';
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
  effective_speaker_role: 'elder' | 'interviewer' | 'unknown';
  trusted_effective_speaker_role: 'elder' | 'interviewer' | 'unknown';
  trusted_speaker_role: 'elder' | 'interviewer' | 'unknown';
  speaker_stream_id: string;
  speaker_role_revision: number;
  content_kind: 'conversation' | 'speaker_calibration';
  start_ms: number;
  end_ms: number;
  text: string;
  finality: 'final';
}

export interface TranscriptSegmentResponse {
  id: string;
  speaker_stream_id: string;
  speaker_provider_id: string | null;
  original_speaker_role: 'elder' | 'interviewer' | 'unknown';
  original_speaker_role_authority: 'unconfirmed' | 'user_confirmed';
  corrected_speaker_role: 'elder' | 'interviewer' | 'unknown' | null;
  effective_speaker_role: 'elder' | 'interviewer' | 'unknown';
  trusted_effective_speaker_role: 'elder' | 'interviewer' | 'unknown';
  speaker_role_revision: number;
  content_kind: 'conversation' | 'speaker_calibration';
  start_ms: number;
  end_ms: number;
  original_text: string;
  corrected_text: string | null;
}

export interface TranscriptPageResponse {
  items: TranscriptSegmentResponse[];
  next_cursor: string | null;
}

export type CorrectedSpeakerRole = 'elder' | 'interviewer' | 'unknown';

export interface CorrectTranscriptSpeakerRoleRequest extends IdempotentRequest {
  corrected_speaker_role: CorrectedSpeakerRole;
  expected_speaker_role_revision: number;
}

export interface SpeakerRoleCorrectionResponse {
  operation_id: string;
  speaker_role_revision: number;
  segment: TranscriptSegmentResponse;
}

export interface PreviewSpeakerRemapRequest extends IdempotentRequest {
  speaker_stream_id: string;
  speaker_provider_id: string;
  corrected_speaker_role: CorrectedSpeakerRole;
  segment_start_id: string;
  segment_end_id: string;
  exclude_individual_corrections: true;
}

export interface SpeakerRemapPreviewResponse {
  preview_id: string;
  preview_hash: string;
  corrected_speaker_role: CorrectedSpeakerRole;
  segment_start_id: string;
  segment_end_id: string;
  candidate_segment_count: number;
  excluded_segment_count: number;
  segment_count: number;
  expires_at: string;
}

export interface ExecuteSpeakerRemapRequest extends IdempotentRequest {
  preview_id: string;
  preview_hash: string;
}

export interface SpeakerRemapExecuteResponse {
  operation_id: string;
  preview_id: string;
  preview_hash: string;
  speaker_role_revision: number;
  segment_count: number;
}

export interface InterviewWsAsrStatusPayload {
  status: 'connected' | 'unavailable';
  code?: 'ASR_UNAVAILABLE';
}

export interface InterviewWsErrorPayload {
  code: string;
  reset_required?: boolean;
}

/**
 * SPEC-LLM-PROVIDER-001 candidate shared contract. It is not a runtime
 * configuration authority until the task's exact head is accepted.
 */
export const LLM_PROVIDER_REGISTRY_VERSION = 'llm-provider-registry-v1' as const;
export const LLM_PROVIDER_REGISTRY_SEMANTICS_VERSION =
  'llm-provider-registry-semantics-v1' as const;
export const LLM_PROVIDER_CALL_RECEIPT_VERSION = 'llm-provider-call-receipt-v1' as const;
export const LLM_MODEL_CONFIG_SCHEMA_VERSION = 'llm-model-config-v1' as const;
export const LLM_MODEL_CONFIG_CANONICALIZATION_VERSION =
  'llm-model-config-canonical-json-v1' as const;

export type LlmProviderDataClass = 'synthetic' | 'deidentified' | 'real_interview';
export type LlmProviderEnvironmentScope = 'development' | 'test' | 'production';
export type LlmJsonValue = null | boolean | number | string | LlmJsonValue[] | LlmJsonObject;
export interface LlmJsonObject {
  [key: string]: LlmJsonValue;
}

export interface LlmProviderActiveBindingV1 {
  requested_provider_id: string;
  requested_provider_model_id: string;
  model_config_version: string;
  model_config_digest: string;
  endpoint_origin: string;
  data_region: string;
  secret_reference: string;
  data_class: LlmProviderDataClass;
  environment_scope: LlmProviderEnvironmentScope;
}

export interface LlmModelConfigReferenceV1 {
  model_config_version: string;
  model_config_digest: string;
}

export interface LlmProviderModelProfileV1 {
  provider_model_id: string;
  model_config_refs: LlmModelConfigReferenceV1[];
}

export interface LlmProviderProcessingRegionV1 {
  data_region: string;
  jurisdiction: 'domestic' | 'foreign';
}

export type LlmProviderRealInterviewPolicyV1 =
  | {
      allowed: false;
      authorization_policy_version: null;
      provider_terms_review_id: null;
      data_retention_review_id: null;
      training_use: 'deny';
      foreign_processing_allowed: false;
      cross_border_decision_id: null;
    }
  | {
      allowed: true;
      authorization_policy_version: string;
      provider_terms_review_id: string;
      data_retention_review_id: string;
      training_use: 'deny';
      foreign_processing_allowed: false;
      cross_border_decision_id: null;
    }
  | {
      allowed: true;
      authorization_policy_version: string;
      provider_terms_review_id: string;
      data_retention_review_id: string;
      training_use: 'deny';
      foreign_processing_allowed: true;
      cross_border_decision_id: string;
    };

export interface LlmProviderProfileV1 {
  provider_id: string;
  provider_package: string;
  provider_package_version: string;
  model_allowlist: LlmProviderModelProfileV1[];
  endpoint_origins: string[];
  processing_regions: LlmProviderProcessingRegionV1[];
  secret_references: string[];
  environment_scopes: LlmProviderEnvironmentScope[];
  allowed_data_classes: LlmProviderDataClass[];
  real_interview_policy: LlmProviderRealInterviewPolicyV1;
}

export type LlmModelConfigReasoningV1 =
  | { mode: 'disabled'; effort: null; budget_tokens: null }
  | {
      mode: 'effort';
      effort: 'minimal' | 'low' | 'medium' | 'high';
      budget_tokens: null;
    }
  | { mode: 'budget'; effort: null; budget_tokens: number };

export interface LlmModelConfigManifestV1 {
  schema_version: typeof LLM_MODEL_CONFIG_SCHEMA_VERSION;
  canonicalization_version: typeof LLM_MODEL_CONFIG_CANONICALIZATION_VERSION;
  model_config_version: string;
  generation: {
    temperature: number | null;
    max_output_tokens: number;
    top_p: number | null;
    top_k: number | null;
    presence_penalty: number | null;
    frequency_penalty: number | null;
    seed: number | null;
    stop_sequences: string[];
    reasoning: LlmModelConfigReasoningV1;
    response_format: 'json_schema';
    tools: 'none';
  };
  provider_options: Record<string, LlmJsonObject>;
}

export interface LlmModelConfigManifestRecordV1 {
  model_config_digest: string;
  manifest: LlmModelConfigManifestV1;
}

export interface LlmProviderRegistryV1 {
  contract_version: typeof LLM_PROVIDER_REGISTRY_VERSION;
  semantic_contract_version: typeof LLM_PROVIDER_REGISTRY_SEMANTICS_VERSION;
  artifact_status: 'candidate';
  sdk: {
    family: 'vercel_ai_sdk';
    core_package: 'ai';
    verified_version: '7.0.65';
    verified_on: '2026-08-14';
    license: 'Apache-2.0';
    node_engine: '>=22';
    dependency_policy: 'exact_reviewed_versions';
    max_retries: 0;
    structured_output: 'output_object_json_schema';
  };
  routing: {
    connection_mode: 'direct_vendor';
    gateway_enabled: false;
    litellm_enabled: false;
    fallback_enabled: false;
    shadow_traffic_enabled: false;
    active_binding: LlmProviderActiveBindingV1 | null;
  };
  runtime: {
    absolute_deadline_ms: 8000;
    coordinator_same_input_retry_max: 1;
    abort_required: true;
    late_result_writeback: 'deny';
    formal_attempt_active_binding_count: 1;
  };
  safety: {
    configuration_authority: 'server_only';
    secret_injection: 'server_reference_only';
    real_interview_data_default: 'deny';
    foreign_real_content_default: 'deny';
    unknown_configuration: 'fail_closed';
    asr_provider_pass_required: 'DEV-ASR-PROVIDER-001';
  };
  prompt: {
    active_formal_bundle: 'interview-director-prompt-v1';
    editable_draft_path: 'docs/prompts/interview-director/v2-draft';
    draft_runtime_loadable: false;
    lifecycle: readonly ['draft', 'candidate', 'formal', 'active'];
    schema_first: true;
  };
  evaluation: {
    allowed_data_classes: readonly ['synthetic', 'deidentified'];
    frozen_inputs_required: true;
    artifact_target: 'isolated_evaluation_artifact';
    prohibited_publish_targets: readonly ['question_current', 'question_history'];
  };
  model_config_manifests: LlmModelConfigManifestRecordV1[];
  providers: LlmProviderProfileV1[];
}

export type LlmObservedResponseModelIdentityV1 =
  | {
      observed_response_model_id: string;
      observed_response_model_id_source: 'provider_origin' | 'sdk_normalized' | 'unknown';
    }
  | {
      observed_response_model_id: null;
      observed_response_model_id_source: 'unavailable';
    };

export type LlmProviderRequestIdentityV1 =
  | {
      provider_request_id: string;
      provider_request_id_source: 'provider';
    }
  | {
      provider_request_id: null;
      provider_request_id_source: 'unavailable';
    };

export type LlmSdkResponseIdentityV1 =
  | {
      sdk_response_id: string;
      sdk_response_id_source: 'provider_origin' | 'sdk_generated' | 'unknown';
    }
  | {
      sdk_response_id: null;
      sdk_response_id_source: 'unavailable';
    };

export type LlmProviderSettingWarningClassificationV1 =
  | 'unsupported_setting'
  | 'ignored_setting'
  | 'adjusted_setting'
  | 'provider_warning_other'
  | 'warning_visibility_unavailable';

export type LlmProviderSettingWarningV1 =
  | {
      classification: 'unsupported_setting' | 'ignored_setting' | 'adjusted_setting';
      setting_path: string;
      sanitized_code: string;
    }
  | {
      classification: 'provider_warning_other' | 'warning_visibility_unavailable';
      setting_path: string | null;
      sanitized_code: string;
    };

export type LlmProviderConfigApplicationV1 =
  | { config_application_status: 'as_requested'; warnings: [] }
  | {
      config_application_status: 'diverged';
      warnings: [LlmProviderSettingWarningV1, ...LlmProviderSettingWarningV1[]];
    }
  | {
      config_application_status: 'unknown';
      warnings: [LlmProviderSettingWarningV1, ...LlmProviderSettingWarningV1[]];
    };

export type LlmProviderCallReceiptV1 = LlmObservedResponseModelIdentityV1 &
  LlmProviderRequestIdentityV1 &
  LlmSdkResponseIdentityV1 &
  LlmProviderConfigApplicationV1 & {
    schema_version: typeof LLM_PROVIDER_CALL_RECEIPT_VERSION;
    requested_provider_id: string;
    requested_provider_model_id: string;
    model_config_schema_version: typeof LLM_MODEL_CONFIG_SCHEMA_VERSION;
    model_config_version: string;
    model_config_digest: string;
    sdk_core_package: 'ai';
    sdk_core_version: string;
    sdk_provider_package: string;
    sdk_provider_package_version: string;
    connection_mode: 'direct_vendor';
    endpoint_origin: string;
    data_region: string;
    token_usage: {
      input_tokens: number | null;
      output_tokens: number | null;
      total_tokens: number | null;
    };
    latency_ms: number;
    status: 'succeeded' | 'failed' | 'aborted' | 'timeout';
    error_code: string | null;
    started_at: string;
    completed_at: string;
    input_digest: string;
    output_digest: string | null;
  };
