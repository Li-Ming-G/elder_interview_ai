// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  AudioManifestResponse,
  InterviewSessionResponse,
  SessionCaptureSnapshot,
  SessionFinalizationSnapshot,
} from '@elder-interview/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InterviewApi, InterviewCaptureApi, PreparationData } from './interview-api.js';
import type {
  CaptureStopHandoff,
  InterviewCaptureController,
  InterviewCaptureControllerSnapshot,
} from './interview-capture-controller.js';
import { WorkbenchShell } from './workbench-shell.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const AUDIO_OBJECT_ID = '33333333-3333-4333-8333-333333333333';
const VERIFIED_AT = '2026-08-08T08:00:00.000Z';

afterEach(cleanup);

describe('WorkbenchShell', () => {
  it('recovers read-only facts without requesting a microphone or resuming on mount', async () => {
    const harness = createHarness(recordingSession());
    renderWorkbench(harness);

    expect(await screen.findByText('当前对话')).toBeTruthy();
    expect(harness.controller.recover).toHaveBeenCalledTimes(1);
    expect(harness.controller.resume).not.toHaveBeenCalled();
    expect(harness.api.createSession).not.toHaveBeenCalled();
    expect(screen.getByText('正在采集 · 本浏览器已保存 2 段')).toBeTruthy();
  });

  it('switches the same mounted page from recording to interrupted and keeps transcript read-only', async () => {
    const harness = createHarness(recordingSession());
    renderWorkbench(harness);
    await screen.findByText('当前对话');

    act(() => {
      harness.emit(
        snapshot(interruptedSession(), {
          phase: 'interrupted',
          realtime: {
            ...EMPTY_REALTIME,
            finals: [
              {
                endMs: 2_000,
                segmentId: 'segment-1',
                speakerRole: 'elder',
                startMs: 1_000,
                text: '那时我们住在河边。',
              },
            ],
          },
        }),
      );
    });

    expect(await screen.findByText('先保护已经录下的内容')).toBeTruthy();
    expect(screen.getByText('那时我们住在河边。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '继续同一次访谈' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '安全结束已有音频' })).toBeTruthy();
    expect(screen.queryByText('服务端进行中')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks for the microphone only after the user chooses to resume an interrupted session', async () => {
    const harness = createHarness(interruptedSession(), { phase: 'interrupted' });
    renderWorkbench(harness);
    const resume = await screen.findByRole('button', { name: '继续同一次访谈' });
    expect(harness.controller.resume).not.toHaveBeenCalled();

    fireEvent.click(resume);
    await waitFor(() => {
      expect(harness.controller.resume).toHaveBeenCalledTimes(1);
    });
  });

  it('fails closed without resume or finalize actions after authority loss', async () => {
    const harness = createHarness(interruptedSession(), {
      lastError: 'AUTHORITY_LOST',
      phase: 'interrupted',
      serverVerificationError: '登录已失效，请重新登录',
    });
    renderWorkbench(harness);

    expect(await screen.findByText(/登录、授权或项目权限当前无法确认/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '继续同一次访谈' })).toBeNull();
    expect(screen.queryByRole('button', { name: '安全结束已有音频' })).toBeNull();
    expect(screen.getByRole('button', { name: '重新核对' })).toBeTruthy();
  });

  it('fails closed for a session that has not been confirmed as recording', async () => {
    const harness = createHarness(session('device_check', { capture: null }), { phase: 'idle' });
    renderWorkbench(harness);

    expect(await screen.findByText('请重新核对访谈状态')).toBeTruthy();
    expect(screen.getByText(/不会申请麦克风或创建新的会话/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '结束访谈' })).toBeNull();
  });

  it('discloses five save facts and preserves local truth when server verification is unavailable', async () => {
    const harness = createHarness(recordingSession(), {
      serverVerificationError: 'NETWORK_UNAVAILABLE',
    });
    renderWorkbench(harness);
    expect(await screen.findByText('本浏览器仍在保存 · 管理服务暂不可核对')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '保存状态' }));
    const details = screen.getByRole('region', { name: '保存状态明细' });
    for (const label of ['采集', '本浏览器 archive', '分片与 manifest', '转录', '会话']) {
      expect(details.textContent).toContain(label);
    }
    expect(details.textContent).toContain('管理服务暂不可核对，保留上次事实');
    expect(details.textContent).toContain('管理服务持久 snapshot');
  });

  it('uses the only modal for ending, defaults focus to continue, supports Escape, and restores focus', async () => {
    const harness = createHarness(recordingSession());
    renderWorkbench(harness);
    const trigger = await screen.findByRole('button', { name: '结束访谈' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(screen.getByText('确定结束本次访谈？')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '继续访谈' }));
    });
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('submits one real frozen stop chain and never completes from a timer', async () => {
    const harness = createHarness(recordingSession());
    renderWorkbench(harness);
    fireEvent.click(await screen.findByRole('button', { name: '结束访谈' }));
    const confirm = screen.getByRole('button', { name: '确认结束' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(harness.controller.stopAndFreeze).toHaveBeenCalledTimes(1);
    });
    expect(harness.api.stopSession).toHaveBeenCalledTimes(1);
    expect(harness.controller.flushDelivery).toHaveBeenCalledTimes(1);
    expect(harness.api.completeInterviewAudio).toHaveBeenCalledTimes(1);
    expect(harness.api.stopSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        audio_object_id: AUDIO_OBJECT_ID,
        expected_chunk_count: 2,
        request_id: 'stop-request',
      }),
    );
  });

  it.each([
    ['stopping', '正在安全保存录音'],
    ['processing', '正在完成转录处理'],
    ['completed', '录音和转录已完成'],
    ['failed', '本次访谈未能自动收束'],
  ] as const)('renders persisted %s facts and actions', async (status, title) => {
    const harness = createHarness(endingSession(status), {
      endHandoff: END_HANDOFF,
      phase: status === 'failed' ? 'failed' : 'stopped',
    });
    renderWorkbench(harness);
    expect(await screen.findByText(title)).toBeTruthy();
    if (status === 'stopping') {
      expect(screen.getByRole('button', { name: '暂不能收起' }).hasAttribute('disabled')).toBe(
        true,
      );
    }
    if (status === 'processing' || status === 'completed') {
      fireEvent.click(screen.getByRole('button', { name: '收起状态' }));
      expect(await screen.findByRole('button', { name: '查看详情' })).toBeTruthy();
    }
  });

  it('does not offer a dead local-save action when a stopping handoff is missing', async () => {
    const harness = createHarness(endingSession('stopping'), {
      endHandoff: null,
      lastError: 'LOCAL_CAPTURE_JOB_MISSING',
      phase: 'stopped',
    });
    renderWorkbench(harness);

    expect(await screen.findByText(/没有找到已冻结的结束交接/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '继续安全保存' })).toBeNull();
    expect(screen.getByRole('button', { name: '继续处理收尾' })).toBeTruthy();
  });

  it('renders NO_AUDIO_CAPTURED as a distinct terminal fact', async () => {
    const harness = createHarness(
      session('failed', {
        capture: { ...CAPTURE, status: 'abandoned_empty' },
        capture_failure_code: 'NO_AUDIO_CAPTURED',
      }),
      { phase: 'stopped' },
    );
    renderWorkbench(harness);
    expect(await screen.findByText('没有录到可保存的内容')).toBeTruthy();
    expect(screen.getByText(/不是“保存完成”/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新准备一次访谈' })).toBeTruthy();
  });

  it('pauses following while reviewing and announces only new final transcript segments', async () => {
    const harness = createHarness(recordingSession());
    renderWorkbench(harness);
    const viewport = await screen.findByTestId('transcript-viewport');
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    fireEvent.scroll(viewport);
    act(() => {
      harness.emit(
        snapshot(recordingSession(), {
          realtime: {
            ...EMPTY_REALTIME,
            finals: [
              {
                endMs: 1_000,
                segmentId: 's1',
                speakerRole: 'interviewer',
                startMs: 0,
                text: '您还记得那条河吗？',
              },
            ],
          },
        }),
      );
    });
    expect(await screen.findByRole('button', { name: /回到最新 · 1 条新内容/ })).toBeTruthy();
  });
});

type CompleteApi = InterviewApi & InterviewCaptureApi;
type MockApi = { [Key in keyof CompleteApi]: ReturnType<typeof vi.fn<CompleteApi[Key]>> };
type ControllerPort = Pick<
  InterviewCaptureController,
  | 'flushDelivery'
  | 'observeServerSession'
  | 'recover'
  | 'resume'
  | 'snapshot'
  | 'stopAndFreeze'
  | 'subscribe'
  | 'verifyServerSession'
>;

function createHarness(
  serverSession: InterviewSessionResponse,
  overrides: Partial<InterviewCaptureControllerSnapshot> = {},
): {
  api: MockApi;
  controller: ControllerPort;
  emit: (next: InterviewCaptureControllerSnapshot) => void;
} {
  let current = snapshot(serverSession, overrides);
  const listeners = new Set<(next: InterviewCaptureControllerSnapshot) => void>();
  const emit = (next: InterviewCaptureControllerSnapshot): void => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  const api = createApi(serverSession);
  const controller: ControllerPort = {
    flushDelivery: vi.fn(() => Promise.resolve(current.archive.pendingDeliveryCount)),
    observeServerSession: vi.fn(
      (next: InterviewSessionResponse): InterviewCaptureControllerSnapshot => {
        emit(snapshot(next, { ...current, serverSession: next, serverVerifiedAt: VERIFIED_AT }));
        return current;
      },
    ),
    recover: vi.fn(
      (next?: InterviewSessionResponse): Promise<InterviewCaptureControllerSnapshot> => {
        emit(snapshot(next ?? serverSession, { ...current, serverSession: next ?? serverSession }));
        return Promise.resolve(current);
      },
    ),
    resume: vi.fn(() => Promise.resolve(current)),
    get snapshot() {
      return current;
    },
    stopAndFreeze: vi.fn(() => Promise.resolve(stopHandoff(current))),
    subscribe: (listener) => {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    verifyServerSession: vi.fn(() => Promise.resolve(current)),
  };
  return { api, controller, emit };
}

function renderWorkbench(harness: ReturnType<typeof createHarness>): void {
  render(
    <WorkbenchShell
      api={harness.api}
      captureController={harness.controller}
      navigate={vi.fn()}
      projectId={PROJECT_ID}
      sessionId={SESSION_ID}
    />,
  );
}

function createApi(serverSession: InterviewSessionResponse): MockApi {
  return {
    abandonEmptyCapture: vi.fn(() => Promise.resolve(serverSession)),
    completeInterviewAudio: vi.fn(() => Promise.resolve(MANIFEST)),
    confirmCaptureActive: vi.fn(),
    createSession: vi.fn(),
    deviceCheck: vi.fn(),
    getSession: vi.fn(() => Promise.resolve(serverSession)),
    loadPreparation: vi.fn(() => Promise.resolve(preparation(serverSession))),
    recoverSession: vi.fn(() => Promise.resolve(endingSession('stopping'))),
    reportCaptureInterrupted: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(() => Promise.resolve(endingSession('stopping'))),
    uploadInterviewChunk: vi.fn(),
  };
}

function preparation(serverSession: InterviewSessionResponse): PreparationData {
  return {
    consents: [
      {
        consent_audio_object_id: null,
        consent_method: 'electronic',
        consent_text_version: 'mvp-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: VERIFIED_AT,
        created_at: VERIFIED_AT,
        created_by: 'user-1',
        id: 'consent-1',
        project_id: PROJECT_ID,
        revoked_at: null,
        status: 'valid',
      },
    ],
    project: {
      approximate_age: null,
      birth_year: null,
      created_at: VERIFIED_AT,
      created_by: 'user-1',
      current_city: null,
      display_name: '林奶奶',
      id: PROJECT_ID,
      native_place: null,
      status: 'active',
      updated_at: VERIFIED_AT,
    },
    serviceTerms: [],
    session: serverSession,
  };
}

function snapshot(
  serverSession: InterviewSessionResponse,
  overrides: Partial<InterviewCaptureControllerSnapshot> = {},
): InterviewCaptureControllerSnapshot {
  return {
    archive: {
      archiveByteLength: 2_048,
      archiveChunkCount: 2,
      archiveHighWaterSequenceNo: 1,
      deliveryAcknowledgedHighWaterSequenceNo: 1,
      pendingDeliveryCount: 0,
      timelineEndMs: 2_000,
    },
    audioObjectId: AUDIO_OBJECT_ID,
    audioStreamId: 'stream-1',
    checkpointDirty: true,
    deliveryError: null,
    endHandoff: null,
    generationNo: 0,
    lastError: null,
    localJobId: `interview-capture:${SESSION_ID}`,
    phase: serverSession.status === 'interrupted' ? 'interrupted' : 'active',
    projectId: PROJECT_ID,
    realtime: EMPTY_REALTIME,
    serverCapture: serverSession.capture ?? null,
    serverSession,
    serverVerificationError: null,
    serverVerifiedAt: VERIFIED_AT,
    sessionId: SESSION_ID,
    storage: null,
    ...overrides,
  };
}

function recordingSession(): InterviewSessionResponse {
  return session('recording', { capture: CAPTURE });
}

function interruptedSession(): InterviewSessionResponse {
  return session('interrupted', {
    capture: {
      ...CAPTURE,
      interrupted_at: VERIFIED_AT,
      interruption_reason: 'microphone_ended',
      status: 'interrupted',
    },
  });
}

function endingSession(
  status: 'stopping' | 'processing' | 'completed' | 'failed',
): InterviewSessionResponse {
  return session(status, {
    capture: { ...CAPTURE, status: 'stopped' },
    duration_seconds: 1_800,
    ended_at: VERIFIED_AT,
    finalization: {
      ...FINALIZATION,
      failure_code: status === 'failed' ? 'FINALIZATION_INTERNAL_FAILURE' : null,
      transcript_status:
        status === 'completed' ? 'drained' : status === 'processing' ? 'draining' : 'pending',
      upload_status: status === 'stopping' ? 'verifying' : 'complete',
    },
  });
}

function session(
  status: InterviewSessionResponse['status'],
  overrides: Partial<InterviewSessionResponse> = {},
): InterviewSessionResponse {
  return {
    created_at: '2026-08-07T00:00:00.000Z',
    created_by: 'user-1',
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 1,
    started_at: '2026-08-08T07:30:00.000Z',
    status,
    updated_at: VERIFIED_AT,
    ...overrides,
  };
}

function stopHandoff(current: InterviewCaptureControllerSnapshot): CaptureStopHandoff {
  return {
    audioObjectId: AUDIO_OBJECT_ID,
    audioStreamId: 'stream-1',
    chunks: [
      {
        checksum: 'checksum',
        end_ms: 1_000,
        mime_type: 'audio/webm',
        sequence_no: 0,
        size_bytes: 1_024,
        start_ms: 0,
      },
      {
        checksum: 'checksum-2',
        end_ms: 2_000,
        mime_type: 'audio/webm',
        sequence_no: 1,
        size_bytes: 1_024,
        start_ms: 1_000,
      },
    ],
    completeRequestId: 'complete-request',
    expectedChunkCount: 2,
    generationNo: 0,
    localJobId: current.localJobId,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    snapshot: current,
    stopRequestId: 'stop-request',
  };
}

const CAPTURE: SessionCaptureSnapshot = {
  audio_object_id: AUDIO_OBJECT_ID,
  audio_stream_id: 'stream-1',
  generation_no: 0,
  interrupted_at: null,
  interruption_reason: null,
  status: 'active',
  timeline_offset_ms: 0,
  uploaded_chunk_count: 2,
};

const FINALIZATION: SessionFinalizationSnapshot = {
  audio_object_id: AUDIO_OBJECT_ID,
  completed_at: null,
  expected_chunk_count: 2,
  failure_code: null,
  manifest_checksum: 'manifest',
  processing_started_at: VERIFIED_AT,
  recording_status: 'stopped',
  transcript_error_code: null,
  transcript_status: 'pending',
  upload_status: 'verifying',
  uploaded_chunk_count: 2,
};

const END_HANDOFF = {
  audioObjectId: AUDIO_OBJECT_ID,
  completeRequestId: 'complete-request',
  expectedChunkCount: 2,
  stopRequestId: 'stop-request',
};

const EMPTY_REALTIME: InterviewCaptureControllerSnapshot['realtime'] = {
  connection: 'connected',
  errorCode: null,
  failureKind: null,
  finals: [],
  interim: null,
  pendingBytes: 0,
  pendingFrames: 0,
  resetRequired: false,
  resumed: false,
};

const MANIFEST: AudioManifestResponse = {
  chunk_count: 2,
  chunks: [],
  completed_at: VERIFIED_AT,
  created_at: VERIFIED_AT,
  created_by: 'user-1',
  id: AUDIO_OBJECT_ID,
  manifest_checksum: 'manifest',
  mime_type: 'audio/webm',
  project_id: PROJECT_ID,
  purpose: 'interview',
  session_id: SESSION_ID,
  status: 'complete',
  total_size_bytes: 2_048,
};
