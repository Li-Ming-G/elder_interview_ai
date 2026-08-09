import type {
  AbandonEmptyCaptureRequest,
  AudioChunkResponse,
  AudioManifestResponse,
  ApiErrorEnvelope,
  ConfirmCaptureActiveRequest,
  ConsentResponse,
  DeviceCheckRequest,
  InterviewSessionResponse,
  ProjectResponse,
  RecoverSessionRequest,
  ReportCaptureInterruptedRequest,
  ServiceTermResponse,
  StartSessionRequest,
  StopSessionRequest,
  BeginSpeakerCalibrationRequest,
  ResolveSpeakerCalibrationRequest,
  SpeakerCalibrationSnapshot,
  CorrectTranscriptSpeakerRoleRequest,
  SpeakerRoleCorrectionResponse,
  TranscriptPageResponse,
  TranscriptSegmentResponse,
} from '@elder-interview/contracts';
import type { ImmutableAudioChunk } from '../audio/types.js';

export class InterviewApiError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'InterviewApiError';
  }
}

export interface PreparationData {
  consents: ConsentResponse[];
  project: ProjectResponse;
  serviceTerms: ServiceTermResponse[];
  session: InterviewSessionResponse | null;
}

export interface InterviewApi {
  createSession(projectId: string): Promise<InterviewSessionResponse>;
  deviceCheck(sessionId: string, request: DeviceCheckRequest): Promise<InterviewSessionResponse>;
  loadPreparation(projectId: string, sessionId: string | null): Promise<PreparationData>;
}

export interface InterviewCaptureApi {
  abandonEmptyCapture(
    sessionId: string,
    request: AbandonEmptyCaptureRequest,
  ): Promise<InterviewSessionResponse>;
  completeInterviewAudio(
    audioObjectId: string,
    request: { expected_chunk_count: number; request_id: string },
  ): Promise<AudioManifestResponse>;
  confirmCaptureActive(
    sessionId: string,
    request: ConfirmCaptureActiveRequest,
  ): Promise<InterviewSessionResponse>;
  getSession(sessionId: string): Promise<InterviewSessionResponse>;
  recoverSession(
    sessionId: string,
    request: RecoverSessionRequest,
  ): Promise<InterviewSessionResponse>;
  reportCaptureInterrupted(
    sessionId: string,
    request: ReportCaptureInterruptedRequest,
  ): Promise<InterviewSessionResponse>;
  startSession(sessionId: string, request: StartSessionRequest): Promise<InterviewSessionResponse>;
  stopSession(sessionId: string, request: StopSessionRequest): Promise<InterviewSessionResponse>;
  uploadInterviewChunk(
    audioObjectId: string,
    chunk: ImmutableAudioChunk,
    requestId: string,
  ): Promise<AudioChunkResponse>;
}

export interface SpeakerCalibrationApi {
  beginSpeakerCalibration(
    sessionId: string,
    request: BeginSpeakerCalibrationRequest,
  ): Promise<SpeakerCalibrationSnapshot>;
  getSpeakerCalibration(sessionId: string): Promise<SpeakerCalibrationSnapshot>;
  resolveSpeakerCalibration(
    attemptId: string,
    request: ResolveSpeakerCalibrationRequest,
  ): Promise<SpeakerCalibrationSnapshot>;
}

export interface SpeakerCorrectionApi {
  correctTranscriptSpeakerRole(
    transcriptSegmentId: string,
    request: CorrectTranscriptSpeakerRoleRequest,
  ): Promise<SpeakerRoleCorrectionResponse>;
  getTranscriptSegment(
    sessionId: string,
    transcriptSegmentId: string,
  ): Promise<TranscriptSegmentResponse>;
}

export function createInterviewApi(
  csrfToken: string,
): InterviewApi & InterviewCaptureApi & SpeakerCalibrationApi & SpeakerCorrectionApi {
  async function read<T>(path: string): Promise<T> {
    return request<T>(path, { cache: 'no-store', credentials: 'same-origin' });
  }

  async function write<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-CSRF-Token': csrfToken,
      },
      method: 'POST',
    });
  }

  async function patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
      body: JSON.stringify(body),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      method: 'PATCH',
    });
  }

  return {
    beginSpeakerCalibration: async (sessionId, input): Promise<SpeakerCalibrationSnapshot> =>
      write(`/api/v1/sessions/${sessionId}/speaker-calibrations`, input),
    abandonEmptyCapture: async (sessionId, request): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/capture/abandon-empty`, request),
    completeInterviewAudio: async (audioObjectId, complete): Promise<AudioManifestResponse> =>
      write(`/api/v1/audio-objects/${audioObjectId}/complete`, complete),
    confirmCaptureActive: async (sessionId, request): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/capture/confirm-active`, request),
    createSession: async (projectId): Promise<InterviewSessionResponse> =>
      write(`/api/v1/projects/${projectId}/sessions`),
    deviceCheck: async (sessionId, deviceCheck): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/device-check`, deviceCheck),
    getSession: async (sessionId): Promise<InterviewSessionResponse> =>
      read(`/api/v1/sessions/${sessionId}`),
    getSpeakerCalibration: async (sessionId): Promise<SpeakerCalibrationSnapshot> =>
      read(`/api/v1/sessions/${sessionId}/speaker-calibration`),
    correctTranscriptSpeakerRole: async (
      transcriptSegmentId,
      input,
    ): Promise<SpeakerRoleCorrectionResponse> =>
      patch(`/api/v1/transcripts/${transcriptSegmentId}/speaker-role`, input),
    getTranscriptSegment: async (
      sessionId,
      transcriptSegmentId,
    ): Promise<TranscriptSegmentResponse> => {
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: '500' });
        if (cursor !== null) query.set('cursor', cursor);
        const page = await read<TranscriptPageResponse>(
          `/api/v1/sessions/${sessionId}/transcripts?${query.toString()}`,
        );
        const segment = page.items.find(({ id }) => id === transcriptSegmentId);
        if (segment !== undefined) return segment;
        cursor = page.next_cursor;
      } while (cursor !== null);
      throw new InterviewApiError('NOT_FOUND', '转录片段已不可用，请重新核对当前会话', 404);
    },
    loadPreparation: async (projectId, sessionId): Promise<PreparationData> => {
      const [project, serviceTerms, consents, session] = await Promise.all([
        read<ProjectResponse>(`/api/v1/projects/${projectId}`),
        read<ServiceTermResponse[]>(`/api/v1/projects/${projectId}/service-terms`),
        read<ConsentResponse[]>(`/api/v1/projects/${projectId}/consents`),
        sessionId === null
          ? Promise.resolve(null)
          : read<InterviewSessionResponse>(`/api/v1/sessions/${sessionId}`),
      ]);
      if (session !== null && session.project_id !== projectId) {
        throw new InterviewApiError('SESSION_PROJECT_MISMATCH', '访谈会话与当前项目不匹配', 409);
      }
      return { consents, project, serviceTerms, session };
    },
    recoverSession: async (sessionId, request): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/recover`, request),
    reportCaptureInterrupted: async (sessionId, request): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/capture/interrupted`, request),
    resolveSpeakerCalibration: async (attemptId, input): Promise<SpeakerCalibrationSnapshot> =>
      write(`/api/v1/speaker-calibrations/${attemptId}/resolve`, input),
    startSession: async (sessionId, request): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/start`, request),
    stopSession: async (sessionId, request): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/stop`, request),
    uploadInterviewChunk: async (audioObjectId, chunk, requestId): Promise<AudioChunkResponse> =>
      request<AudioChunkResponse>(
        `/api/v1/audio-objects/${audioObjectId}/chunks/${String(chunk.sequenceNo)}`,
        {
          body: chunk.blob,
          credentials: 'same-origin',
          headers: {
            'Content-Type': chunk.mimeType,
            'X-Chunk-End-Ms': String(chunk.endedAtMs),
            'X-Chunk-SHA256': chunk.checksumSha256,
            'X-Chunk-Start-Ms': String(chunk.startedAtMs),
            'X-CSRF-Token': csrfToken,
            'X-Request-Id': requestId,
          },
          method: 'PUT',
        },
      ),
  };
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new InterviewApiError('NETWORK_UNAVAILABLE', '暂时无法连接服务，请检查网络后重试', 0);
  }
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<InterviewApiError> {
  try {
    const payload = (await response.json()) as Partial<ApiErrorEnvelope>;
    return new InterviewApiError(
      typeof payload.code === 'string' ? payload.code : 'REQUEST_FAILED',
      safeMessage(payload.code),
      response.status,
    );
  } catch {
    return new InterviewApiError('REQUEST_FAILED', '请求未能完成，请稍后重试', response.status);
  }
}

function safeMessage(code: unknown): string {
  switch (code) {
    case 'AUTH_REQUIRED':
      return '登录已失效，请重新登录';
    case 'FORBIDDEN':
      return '无法访问此项目，请联系项目负责人确认分配';
    case 'CONSENT_REQUIRED':
      return '正式授权当前无效，请先核对授权记录';
    case 'SERVICE_TERM_REQUIRED':
      return '服务说明尚未完成，暂不能开始访谈';
    case 'INVALID_SESSION_STATE':
      return '当前访谈状态不允许执行此操作，请刷新后核对';
    case 'DEVICE_CHECK_REQUIRED':
      return '请先完成麦克风与输入检测';
    case 'PROJECT_NOT_READY':
      return '项目当前尚未达到可访谈状态';
    case 'CAPTURE_EVIDENCE_EXISTS':
      return '管理服务检测到已有音频证据，请改为安全保存已有内容';
    case 'SESSION_STOP_CONFLICT':
      return '结束边界与管理服务已保存的事实不一致，请停止操作并重新核对';
    case 'AUDIO_MANIFEST_INCOMPLETE':
      return '仍有录音分片尚未保存完整，请保持页面打开并重新核对';
    case 'SESSION_FINALIZATION_UNAVAILABLE':
      return '管理服务暂时无法收束本次访谈，请稍后重新核对';
    case 'SPEAKER_ROLE_VERSION_CONFLICT':
      return '说话人角色已由其他操作更新，已重新读取最新事实';
    case 'SPEAKER_ROLE_UPDATE_FORBIDDEN':
      return '当前授权、分配或项目状态不允许修正说话人角色';
    case 'SPEAKER_REMAP_PREVIEW_STALE':
      return '批量预览已失效，请重新生成预览后再执行';
    default:
      return '操作未能完成，请核对当前状态后重试';
  }
}
