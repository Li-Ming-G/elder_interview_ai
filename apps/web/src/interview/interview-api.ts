import type {
  AudioChunkResponse,
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
  uploadInterviewChunk(
    audioObjectId: string,
    chunk: ImmutableAudioChunk,
    requestId: string,
  ): Promise<AudioChunkResponse>;
}

export function createInterviewApi(csrfToken: string): InterviewApi & InterviewCaptureApi {
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

  return {
    confirmCaptureActive: async (sessionId, request): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/capture/confirm-active`, request),
    createSession: async (projectId): Promise<InterviewSessionResponse> =>
      write(`/api/v1/projects/${projectId}/sessions`),
    deviceCheck: async (sessionId, deviceCheck): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/device-check`, deviceCheck),
    getSession: async (sessionId): Promise<InterviewSessionResponse> =>
      read(`/api/v1/sessions/${sessionId}`),
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
    startSession: async (sessionId, request): Promise<InterviewSessionResponse> =>
      write(`/api/v1/sessions/${sessionId}/start`, request),
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
    default:
      return '操作未能完成，请核对当前状态后重试';
  }
}
