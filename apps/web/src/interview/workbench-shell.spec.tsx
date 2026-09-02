// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  AudioManifestResponse,
  InterviewSessionResponse,
  ResolveSpeakerCalibrationRequest,
  SessionCaptureSnapshot,
  SessionFinalizationSnapshot,
  SpeakerCalibrationSnapshot,
  SpeakerRoleCorrectionResponse,
  TranscriptSegmentResponse,
} from '@elder-interview/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  InterviewApi,
  InterviewCaptureApi,
  PreparationData,
  SpeakerCorrectionApi,
  SuggestionApi,
} from './interview-api.js';
import { InterviewApiError } from './interview-api.js';
import type {
  CaptureStopHandoff,
  InterviewCaptureController,
  InterviewCaptureControllerSnapshot,
} from './interview-capture-controller.js';
import { WorkbenchShell, type WorkbenchNavigationRequest } from './workbench-shell.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const AUDIO_OBJECT_ID = '33333333-3333-4333-8333-333333333333';
const VERIFIED_AT = '2026-08-08T08:00:00.000Z';

afterEach(() => {
  cleanup();
  globalThis.sessionStorage.clear();
});

describe('WorkbenchShell', () => {
  it('projects automatic, continue-listening, unavailable and manual outcomes through the formal Workbench', async () => {
    const automatic = currentSuggestion('suggestion', 'Synthetic automatic question');
    const continuing = currentSuggestion('continue_listening', null, 3);
    const unavailable = currentSuggestion('unavailable', null, 4);
    const manual = currentSuggestion('suggestion', 'Synthetic manual-next question', 5);
    const suggestionApi = createSuggestionApi();
    const harness = createHarness(
      recordingSession(),
      {
        realtime: {
          ...EMPTY_REALTIME,
          finals: [
            {
              contentKind: 'conversation',
              endMs: 2_000,
              segmentId: 'synthetic-final-segment',
              speakerRole: 'elder',
              startMs: 1_000,
              text: 'Synthetic finalized transcript remains visible.',
            },
          ],
        },
      },
      suggestionApi,
    );
    const getCurrentSuggestion = vi
      .mocked(suggestionApi.getCurrentSuggestion)
      .mockResolvedValueOnce(automatic)
      .mockResolvedValueOnce(continuing)
      .mockResolvedValueOnce(unavailable);
    vi.mocked(suggestionApi.requestNextSuggestion).mockResolvedValue({
      accepted_presentation_revision: 4,
      attempt_id: '44444444-4444-4444-8444-444444444444',
      request_id: '55555555-5555-4555-8555-555555555555',
      retry_after_ms: 0,
      status: 'running',
    });
    vi.mocked(suggestionApi.getSuggestionRequest).mockResolvedValue({
      attempt_id: '44444444-4444-4444-8444-444444444444',
      current: manual,
      error_code: null,
      publication_outcome: 'published',
      request_id: '55555555-5555-4555-8555-555555555555',
      result_kind: 'suggestion',
      status: 'succeeded',
    });

    renderWorkbench(harness);
    expect(
      await screen.findByRole('heading', { name: 'Synthetic automatic question' }),
    ).toBeTruthy();

    act(() => {
      harness.emit(
        snapshot(recordingSession(), {
          realtime: { ...EMPTY_REALTIME, suggestionPresentationRevision: 3 },
        }),
      );
    });
    expect(await screen.findByRole('heading', { name: '继续倾听' })).toBeTruthy();

    act(() => {
      harness.emit(
        snapshot(recordingSession(), {
          realtime: {
            ...EMPTY_REALTIME,
            finals: [
              {
                contentKind: 'conversation',
                endMs: 2_000,
                segmentId: 'synthetic-final-segment',
                speakerRole: 'elder',
                startMs: 1_000,
                text: 'Synthetic finalized transcript remains visible.',
              },
            ],
            suggestionPresentationRevision: 4,
          },
        }),
      );
    });
    expect(await screen.findByRole('heading', { name: '问题建议暂不可用' })).toBeTruthy();
    expect(screen.getByText('Synthetic finalized transcript remains visible.')).toBeTruthy();
    expect(screen.getByText('正在采集 · 本浏览器已保存 2 段')).toBeTruthy();

    await waitFor(() => {
      expect(getCurrentSuggestion).toHaveBeenCalledTimes(3);
    });
    fireEvent.click(screen.getByRole('button', { name: '下一个问题' }));
    expect(
      await screen.findByRole('heading', { name: 'Synthetic manual-next question' }),
    ).toBeTruthy();
    expect(suggestionApi.requestNextSuggestion).toHaveBeenCalledTimes(1);
  });

  it('recovers read-only facts without requesting a microphone or resuming on mount', async () => {
    const harness = createHarness(recordingSession());
    renderWorkbench(harness);

    expect(await screen.findByText('当前对话')).toBeTruthy();
    expect(harness.controller.recover).toHaveBeenCalledTimes(1);
    expect(harness.controller.resume).not.toHaveBeenCalled();
    expect(harness.api.createSession).not.toHaveBeenCalled();
    expect(screen.getByText('正在采集 · 本浏览器已保存 2 段')).toBeTruthy();
  });

  it('protects browser refresh while formal capture needs attention and removes protection at terminal state', async () => {
    const harness = createHarness(recordingSession());
    renderWorkbench(harness);
    await screen.findByText('当前对话');

    const activeUnload = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(activeUnload);
    expect(activeUnload.defaultPrevented).toBe(true);

    act(() => {
      harness.emit(
        snapshot(endingSession('completed'), {
          endHandoff: END_HANDOFF,
          phase: 'stopped',
        }),
      );
    });
    const terminalUnload = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(terminalUnload);
    expect(terminalUnload.defaultPrevented).toBe(false);
  });

  it('offers the same End Interview action during speaker calibration', async () => {
    const harness = createHarness(recordingSession(), {
      realtime: { ...EMPTY_REALTIME, calibration: calibrationSnapshot('collecting') },
    });
    renderWorkbench(harness);

    expect(await screen.findByRole('heading', { name: '先确认两位说话人' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '结束访谈' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续访谈' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('guards navigation with stay and end-and-leave choices', async () => {
    const harness = createHarness(recordingSession());
    let guard: ((request: WorkbenchNavigationRequest) => void) | null = null;
    const commit = vi.fn();
    renderWorkbench(harness, vi.fn(), vi.fn(), (next) => {
      guard = next;
    });
    await screen.findByText('当前对话');

    const invokeGuard = (request: WorkbenchNavigationRequest): void => {
      if (guard === null) throw new Error('navigation guard was not registered');
      guard(request);
    };
    invokeGuard({ commit, path: '/', replace: false });
    expect(await screen.findByRole('heading', { name: '访谈正在进行' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '留在访谈中' }));
    expect(commit).not.toHaveBeenCalled();

    vi.mocked(harness.controller.stopAndFreeze).mockImplementation(() => {
      harness.emit(
        snapshot(endingSession('stopping'), {
          endHandoff: END_HANDOFF,
          phase: 'stopped',
        }),
      );
      return Promise.resolve(stopHandoff(harness.controller.snapshot));
    });
    vi.mocked(harness.controller.completeFrozenAudio).mockImplementation(() => {
      harness.emit(
        snapshot(endingSession('completed'), {
          endHandoff: END_HANDOFF,
          phase: 'stopped',
        }),
      );
      return Promise.resolve(harness.controller.snapshot);
    });
    harness.api.recoverSession.mockResolvedValue(endingSession('completed'));
    invokeGuard({ commit, path: '/', replace: false });
    fireEvent.click(await screen.findByRole('button', { name: '结束访谈并离开' }));
    await waitFor(() => {
      expect(harness.controller.stopAndFreeze).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps calibration evidence out of the ordinary transcript projection', async () => {
    const harness = createHarness(recordingSession(), {
      realtime: {
        ...EMPTY_REALTIME,
        calibration: calibrationSnapshot('confirmed'),
        finals: [
          {
            contentKind: 'speaker_calibration',
            endMs: 500,
            segmentId: 'calibration-segment',
            speakerRole: 'interviewer',
            startMs: 0,
            text: '我是访谈员',
          },
          {
            contentKind: 'conversation',
            endMs: 1_500,
            segmentId: 'conversation-segment',
            speakerRole: 'elder',
            startMs: 500,
            text: '我们从河边的老房子说起。',
          },
        ],
      },
    });
    renderWorkbench(harness);

    expect(await screen.findByText('我们从河边的老房子说起。')).toBeTruthy();
    expect(screen.queryByText('我是访谈员')).toBeNull();
    expect(screen.queryByText('校准片段')).toBeNull();
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
    expect(screen.getByRole('button', { name: '重新核对当前状态' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '离开工作台' })).toBeTruthy();
  });

  it('offers a real login return after an initial authenticated load expires', async () => {
    const authError = new InterviewApiError('AUTH_REQUIRED', '登录已失效，请重新登录', 401);
    const harness = createHarness(recordingSession());
    const onReturnToLogin = vi.fn();
    harness.api.loadPreparation.mockRejectedValueOnce(authError);
    vi.mocked(harness.controller.verifyServerSession).mockRejectedValueOnce(authError);
    renderWorkbench(harness, onReturnToLogin);

    const returnToLogin = await screen.findByRole('button', { name: '返回登录' });
    expect(harness.controller.verifyServerSession).toHaveBeenCalledTimes(1);
    expect(harness.controller.resume).not.toHaveBeenCalled();
    expect(harness.controller.stopAndFreeze).not.toHaveBeenCalled();
    fireEvent.click(returnToLogin);
    expect(onReturnToLogin).toHaveBeenCalledTimes(1);
  });

  it('fails closed and offers safe leave without promising login recovery for a load 403', async () => {
    const authorityError = new InterviewApiError('FORBIDDEN', '无法访问此项目', 403);
    const harness = createHarness(recordingSession());
    const navigate = vi.fn();
    harness.api.loadPreparation.mockRejectedValueOnce(authorityError);
    vi.mocked(harness.controller.verifyServerSession).mockRejectedValueOnce(authorityError);
    renderWorkbench(harness, vi.fn(), navigate);

    const leave = await screen.findByRole('button', { name: '离开工作台' });
    expect(screen.queryByRole('button', { name: '返回登录' })).toBeNull();
    expect(harness.controller.resume).not.toHaveBeenCalled();
    expect(harness.controller.stopAndFreeze).not.toHaveBeenCalled();
    fireEvent.click(leave);
    expect(navigate).toHaveBeenCalledWith('/', true);
  });

  it('fails closed and exposes login return when a running verification receives 401', async () => {
    const authError = new InterviewApiError('AUTH_REQUIRED', '登录已失效，请重新登录', 401);
    const harness = createHarness(recordingSession());
    const onReturnToLogin = vi.fn();
    renderWorkbench(harness, onReturnToLogin);
    await screen.findByText('当前对话');
    vi.mocked(harness.controller.verifyServerSession).mockImplementationOnce(() => {
      harness.emit(
        snapshot(interruptedSession(), {
          lastError: 'AUTHORITY_LOST',
          phase: 'interrupted',
          serverVerificationError: 'AUTH_REQUIRED',
        }),
      );
      return Promise.reject(authError);
    });

    fireEvent(globalThis.window, new Event('online'));
    const returnToLogin = await screen.findByRole('button', { name: '返回登录' });
    expect(screen.queryByRole('button', { name: '继续同一次访谈' })).toBeNull();
    expect(screen.queryByRole('button', { name: '安全结束已有音频' })).toBeNull();
    expect(harness.controller.resume).not.toHaveBeenCalled();
    expect(harness.controller.stopAndFreeze).not.toHaveBeenCalled();
    fireEvent.click(returnToLogin);
    expect(onReturnToLogin).toHaveBeenCalledTimes(1);
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

  it('explains a delivery failure without misreporting the local archive as failed', async () => {
    const harness = createHarness(recordingSession(), { deliveryError: 'NETWORK_UNAVAILABLE' });
    renderWorkbench(harness);

    expect(await screen.findByText('本浏览器仍在保存 · 管理服务交付暂不可用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存状态' }));
    const details = screen.getByRole('region', { name: '保存状态明细' });
    expect(details.textContent).toContain('本浏览器录音仍保留 · 管理服务交付暂不可用，等待重试');
    expect(details.textContent).not.toContain('本浏览器保存失败');
  });

  it.each([
    ['normal', '结束访谈', 'button'],
    ['normal', '结束访谈', 'escape'],
    ['interrupted', '安全结束已有音频', 'button'],
    ['interrupted', '安全结束已有音频', 'escape'],
    ['empty', '结束无音频会话', 'button'],
    ['empty', '结束无音频会话', 'escape'],
  ] as const)(
    'restores focus to the %s end trigger %s after %s cancellation',
    async (mode, triggerName, cancellation) => {
      const harness = endModeHarness(mode);
      renderWorkbench(harness);
      const trigger = await screen.findByRole('button', { name: triggerName });
      fireEvent.click(trigger);

      const dialog = screen.getByRole('dialog');
      expect(screen.getByText('确定结束本次访谈？')).toBeTruthy();
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByRole('button', { name: '继续访谈' }));
      });
      if (cancellation === 'button') {
        fireEvent.click(screen.getByRole('button', { name: '继续访谈' }));
      } else {
        fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
      }
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(document.activeElement).toBe(trigger);
    },
  );

  it('submits one real frozen stop chain and never completes from a timer', async () => {
    const harness = createHarness(recordingSession());
    vi.mocked(harness.controller.stopAndFreeze).mockImplementation(() => {
      const handoff = stopHandoff(harness.controller.snapshot);
      harness.emit(
        snapshot(endingSession('stopping'), {
          endHandoff: END_HANDOFF,
          phase: 'stopped',
        }),
      );
      return Promise.resolve(handoff);
    });
    renderWorkbench(harness);
    fireEvent.click(await screen.findByRole('button', { name: '结束访谈' }));
    const confirm = screen.getByRole('button', { name: '确认结束' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(harness.controller.stopAndFreeze).toHaveBeenCalledTimes(1);
    });
    expect(harness.api.stopSession).toHaveBeenCalledTimes(1);
    expect(harness.controller.completeFrozenAudio).toHaveBeenCalledTimes(1);
    expect(harness.api.recoverSession).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(harness.controller.completeFrozenAudio).toHaveBeenCalledTimes(1);
    });
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
    if (status === 'processing') {
      fireEvent.click(screen.getByRole('button', { name: '收起状态' }));
      expect(await screen.findByRole('button', { name: '查看详情' })).toBeTruthy();
    }
    if (status === 'completed') {
      const completedHeading = screen.getByRole('heading', { name: '录音和转录已完成' });
      await waitFor(() => {
        expect(completedHeading).toBe(document.activeElement);
      });
      expect(screen.getByRole('button', { name: '查看回顾' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '返回工作区' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: '当前对话' })).toBeNull();
      expect(screen.queryByTestId('transcript-viewport')).toBeNull();
      expect(screen.queryByRole('button', { name: '收起状态' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: /继续处理收尾|继续安全保存/ })).toBeNull();
    await waitFor(() => {
      expect(harness.api.recoverSession).toHaveBeenCalledTimes(1);
    });
  });

  it('automatically closes out and preserves the reconcile id for an explicit failure retry', async () => {
    const harness = createHarness(endingSession('stopping'), {
      endHandoff: END_HANDOFF,
      phase: 'stopped',
    });
    harness.api.recoverSession.mockResolvedValueOnce(endingSession('processing'));
    renderWorkbench(harness);
    await waitFor(() => {
      expect(harness.api.recoverSession).toHaveBeenCalledTimes(1);
    });
    expect(harness.controller.completeFrozenAudio).toHaveBeenCalledTimes(1);
    await screen.findByText('正在完成转录处理');

    const retryHarness = createHarness(endingSession('stopping'), {
      endHandoff: END_HANDOFF,
      phase: 'stopped',
    });
    retryHarness.api.recoverSession.mockRejectedValueOnce(
      new InterviewApiError('NETWORK_UNAVAILABLE', '暂时无法连接服务', 0),
    );
    cleanup();
    renderWorkbench(retryHarness);
    await screen.findByText(/暂时无法连接服务/);
    const firstId = retryHarness.api.recoverSession.mock.calls[0]?.[1].request_id;

    const reloadedHarness = createHarness(endingSession('stopping'), {
      endHandoff: END_HANDOFF,
      phase: 'stopped',
    });
    reloadedHarness.api.recoverSession
      .mockRejectedValueOnce(new InterviewApiError('NETWORK_UNAVAILABLE', '暂时无法连接服务', 0))
      .mockResolvedValueOnce(endingSession('stopping'));
    cleanup();
    renderWorkbench(reloadedHarness);
    await screen.findByText(/暂时无法连接服务/);
    expect(reloadedHarness.api.recoverSession.mock.calls[0]?.[1].request_id).toBe(firstId);
    const retry = screen.getByRole('button', { name: '重新核对保存状态' });
    expect(screen.queryByRole('button', { name: '重新核对当前状态' })).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => {
      expect(reloadedHarness.api.recoverSession).toHaveBeenCalledTimes(2);
    });
    expect(reloadedHarness.api.recoverSession.mock.calls[1]?.[1].request_id).toBe(firstId);
  });

  it.each([
    ['processing', '安全离开'],
    ['completed', '返回工作区'],
    ['failed', '保留现状并离开'],
  ] as const)('uses truthful leave copy for %s', async (status, label) => {
    const harness = createHarness(endingSession(status), {
      endHandoff: END_HANDOFF,
      phase: status === 'failed' ? 'failed' : 'stopped',
    });
    renderWorkbench(harness);
    expect(await screen.findByRole('button', { name: label })).toBeTruthy();
    if (status !== 'completed') {
      expect(screen.queryByRole('button', { name: '完成并离开' })).toBeNull();
    }
  });

  it('does not claim completion for a blocked workbench', async () => {
    const harness = createHarness(session('device_check', { capture: null }), { phase: 'idle' });
    renderWorkbench(harness);
    expect(await screen.findByRole('button', { name: '离开工作台' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '完成并离开' })).toBeNull();
  });

  it('returns to the workspace before preparing another session after NO_AUDIO_CAPTURED', async () => {
    const harness = createHarness(
      session('failed', {
        capture: { ...CAPTURE, status: 'abandoned_empty' },
        capture_failure_code: 'NO_AUDIO_CAPTURED',
      }),
      { phase: 'stopped' },
    );
    const navigate = vi.fn();
    renderWorkbench(harness, vi.fn(), navigate);
    expect(await screen.findByText('没有录到可保存的内容')).toBeTruthy();
    expect(screen.getByText(/不是“保存完成”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回工作区重新准备' }));
    expect(navigate).toHaveBeenCalledWith('/', true);
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

  it('corrects one persisted final inline without touching the capture controller', async () => {
    const harness = createHarness(recordingSession(), {
      realtime: {
        ...EMPTY_REALTIME,
        finals: [
          {
            endMs: 2_000,
            segmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            speakerRole: 'unknown',
            speakerRoleRevision: 0,
            startMs: 1_000,
            text: '那时我们住在河边。',
          },
        ],
      },
    });
    renderWorkbench(harness);
    fireEvent.click(await screen.findByRole('button', { name: '修正角色' }));
    const select = screen.getByRole('combobox', { name: '角色' });
    expect(document.activeElement).toBe(select);
    fireEvent.change(select, { target: { value: 'elder' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(harness.api.correctTranscriptSpeakerRole).toHaveBeenCalledWith(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expect.objectContaining({
          corrected_speaker_role: 'elder',
          expected_speaker_role_revision: 0,
        }),
      );
    });
    expect(await screen.findByText('角色已修正为长者')).toBeTruthy();
    expect(harness.controller.resume).not.toHaveBeenCalled();
  });

  it('reuses the correction request id after an unknown network result and rotates it after success', async () => {
    const harness = createHarness(recordingSession(), {
      realtime: {
        ...EMPTY_REALTIME,
        finals: [
          {
            endMs: 2_000,
            segmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            speakerRole: 'unknown',
            speakerRoleRevision: 0,
            startMs: 1_000,
            text: '那时我们住在河边。',
          },
        ],
      },
    });
    harness.api.correctTranscriptSpeakerRole.mockRejectedValueOnce(
      new InterviewApiError('NETWORK_UNAVAILABLE', 'response unknown', 0),
    );
    renderWorkbench(harness);

    fireEvent.click(await screen.findByRole('button', { name: '修正角色' }));
    fireEvent.change(screen.getByRole('combobox', { name: '角色' }), {
      target: { value: 'elder' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(harness.api.correctTranscriptSpeakerRole).toHaveBeenCalledTimes(1);
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(false);
    });
    const firstRequestId = harness.api.correctTranscriptSpeakerRole.mock.calls[0]?.[1].request_id;

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(harness.api.correctTranscriptSpeakerRole).toHaveBeenCalledTimes(2);
    });
    const retriedRequestId = harness.api.correctTranscriptSpeakerRole.mock.calls[1]?.[1].request_id;
    expect(retriedRequestId).toBe(firstRequestId);
    expect(await screen.findByText('角色已修正为长者')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '修正角色' }));
    fireEvent.change(screen.getByRole('combobox', { name: '角色' }), {
      target: { value: 'interviewer' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(harness.api.correctTranscriptSpeakerRole).toHaveBeenCalledTimes(3);
    });
    expect(harness.api.correctTranscriptSpeakerRole.mock.calls[2]?.[1].request_id).not.toBe(
      firstRequestId,
    );
  });

  it('does not reuse a pending correction attempt after changing the role or cancelling', async () => {
    const harness = createHarness(recordingSession(), {
      realtime: {
        ...EMPTY_REALTIME,
        finals: [
          {
            endMs: 2_000,
            segmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            speakerRole: 'unknown',
            speakerRoleRevision: 0,
            startMs: 1_000,
            text: '那时我们住在河边。',
          },
        ],
      },
    });
    harness.api.correctTranscriptSpeakerRole
      .mockRejectedValueOnce(new InterviewApiError('NETWORK_UNAVAILABLE', 'unknown one', 0))
      .mockRejectedValueOnce(new InterviewApiError('NETWORK_UNAVAILABLE', 'unknown two', 0))
      .mockRejectedValueOnce(new InterviewApiError('NETWORK_UNAVAILABLE', 'unknown three', 0));
    renderWorkbench(harness);

    fireEvent.click(await screen.findByRole('button', { name: '修正角色' }));
    const select = screen.getByRole('combobox', { name: '角色' });
    fireEvent.change(select, { target: { value: 'elder' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(harness.api.correctTranscriptSpeakerRole).toHaveBeenCalledTimes(1);
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(false);
    });
    const firstRequestId = harness.api.correctTranscriptSpeakerRole.mock.calls[0]?.[1].request_id;

    fireEvent.change(select, { target: { value: 'interviewer' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(harness.api.correctTranscriptSpeakerRole).toHaveBeenCalledTimes(2);
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(false);
    });
    const changedRoleRequestId =
      harness.api.correctTranscriptSpeakerRole.mock.calls[1]?.[1].request_id;
    expect(changedRoleRequestId).not.toBe(firstRequestId);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '修正角色' }));
    fireEvent.change(screen.getByRole('combobox', { name: '角色' }), {
      target: { value: 'elder' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(harness.api.correctTranscriptSpeakerRole).toHaveBeenCalledTimes(3);
    });
    const afterCancelRequestId =
      harness.api.correctTranscriptSpeakerRole.mock.calls[2]?.[1].request_id;
    expect(afterCancelRequestId).not.toBe(firstRequestId);
    expect(afterCancelRequestId).not.toBe(changedRoleRequestId);
  });

  it('rereads canonical server facts after a role revision conflict instead of forcing overwrite', async () => {
    const harness = createHarness(recordingSession(), {
      realtime: {
        ...EMPTY_REALTIME,
        finals: [
          {
            endMs: 2_000,
            segmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            speakerRole: 'unknown',
            speakerRoleRevision: 0,
            startMs: 1_000,
            text: '那时我们住在河边。',
          },
        ],
      },
    });
    harness.api.correctTranscriptSpeakerRole.mockRejectedValueOnce(
      new InterviewApiError('SPEAKER_ROLE_VERSION_CONFLICT', 'conflict', 409),
    );
    renderWorkbench(harness);
    fireEvent.click(await screen.findByRole('button', { name: '修正角色' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(harness.api.getTranscriptSegment).toHaveBeenCalledWith(
        SESSION_ID,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      );
    });
    expect(await screen.findByText(/已重新读取服务端事实/)).toBeTruthy();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '角色' }).value).toBe(
      'interviewer',
    );
  });

  it('keeps recording explicit while confirming, skipping, and retrying speaker calibration', async () => {
    const resolveSpeakerCalibration = vi.fn(() =>
      Promise.resolve(calibrationSnapshot('confirmed')),
    );
    const beginSpeakerCalibration = vi.fn(() => Promise.resolve(calibrationSnapshot('collecting')));
    const harness = createHarness(recordingSession(), {
      realtime: { ...EMPTY_REALTIME, calibration: calibrationSnapshot('collecting') },
    });
    Object.assign(harness.api, { beginSpeakerCalibration, resolveSpeakerCalibration });
    renderWorkbench(harness);

    expect(await screen.findByText('正在录音 · 正在确认说话人')).toBeTruthy();
    expect(screen.getByText(/第一位是访谈员/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '交换对应关系' }));
    fireEvent.click(screen.getByRole('button', { name: '确认说话人' }));
    await waitFor(() => {
      expect(resolveSpeakerCalibration).toHaveBeenCalledTimes(1);
    });
    expect(resolveSpeakerCalibration).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        action: 'confirm',
        mappings: [
          { speaker_provider_id: 'speaker_1', speaker_role: 'elder' },
          { speaker_provider_id: 'speaker_2', speaker_role: 'interviewer' },
        ],
      }),
    );

    act(() => {
      harness.emit(
        snapshot(recordingSession(), {
          realtime: { ...EMPTY_REALTIME, calibration: calibrationSnapshot('skipped') },
        }),
      );
    });
    expect(await screen.findByRole('heading', { name: '当前对话' })).toBeTruthy();
    expect(screen.queryByText('正在录音 · 已跳过说话人确认')).toBeNull();

    act(() => {
      harness.emit(
        snapshot(recordingSession(), {
          realtime: { ...EMPTY_REALTIME, calibration: calibrationSnapshot('confirmed') },
        }),
      );
    });
    expect(await screen.findByRole('heading', { name: '当前对话' })).toBeTruthy();
  });

  it('resolves an existing collecting attempt through the server before degraded continuation', async () => {
    const resolveSpeakerCalibration = vi.fn(() => Promise.resolve(calibrationSnapshot('skipped')));
    const harness = createHarness(recordingSession(), {
      realtime: {
        ...EMPTY_REALTIME,
        calibration: calibrationSnapshot('collecting'),
        connection: 'unavailable',
        errorCode: 'ASR_UNAVAILABLE',
        failureKind: 'asr',
      },
    });
    Object.assign(harness.api, { resolveSpeakerCalibration });
    renderWorkbench(harness);

    fireEvent.click(await screen.findByRole('button', { name: '跳过说话人确认并继续访谈' }));
    await waitFor(() => {
      expect(resolveSpeakerCalibration).toHaveBeenCalledWith(
        '55555555-5555-4555-8555-555555555555',
        expect.objectContaining({ action: 'skip', mappings: [] }),
      );
    });
    expect(await screen.findByRole('heading', { name: '当前对话' })).toBeTruthy();
  });

  it('reuses the calibration skip request id after an unknown degraded response', async () => {
    const resolveSpeakerCalibration = vi
      .fn<
        (
          attemptId: string,
          input: ResolveSpeakerCalibrationRequest,
        ) => Promise<SpeakerCalibrationSnapshot>
      >()
      .mockRejectedValueOnce(new InterviewApiError('NETWORK_UNAVAILABLE', 'response unknown', 0))
      .mockResolvedValueOnce(calibrationSnapshot('skipped'));
    const harness = createHarness(recordingSession(), {
      realtime: {
        ...EMPTY_REALTIME,
        calibration: calibrationSnapshot('collecting'),
        connection: 'unavailable',
        failureKind: 'asr',
      },
    });
    Object.assign(harness.api, { resolveSpeakerCalibration });
    renderWorkbench(harness);

    fireEvent.click(await screen.findByRole('button', { name: '跳过说话人确认并继续访谈' }));
    await screen.findByText(/response unknown/);
    const firstRequestId = resolveSpeakerCalibration.mock.calls[0]?.[1].request_id;
    fireEvent.click(screen.getByRole('button', { name: '跳过说话人确认并继续访谈' }));
    await waitFor(() => {
      expect(resolveSpeakerCalibration).toHaveBeenCalledTimes(2);
    });
    expect(resolveSpeakerCalibration.mock.calls[1]?.[1].request_id).toBe(firstRequestId);
  });

  it('fences calibration interim after degraded bypass and shows later conversation interim', async () => {
    const noAttempt = {
      ...calibrationSnapshot('skipped'),
      attempt: null,
      speaker_role_revision: 0,
      status: 'not_started' as const,
    };
    const beginSpeakerCalibration = vi.fn(() => Promise.resolve(calibrationSnapshot('collecting')));
    const harness = createHarness(recordingSession(), {
      realtime: {
        ...EMPTY_REALTIME,
        calibration: noAttempt,
        connection: 'unavailable',
        errorCode: 'ASR_UNAVAILABLE',
        failureKind: 'asr',
      },
    });
    Object.assign(harness.api, { beginSpeakerCalibration });
    renderWorkbench(harness);

    fireEvent.click(await screen.findByRole('button', { name: '跳过说话人确认并继续访谈' }));
    expect(await screen.findByRole('heading', { name: '当前对话' })).toBeTruthy();

    act(() => {
      harness.emit(
        snapshot(recordingSession(), {
          realtime: {
            ...EMPTY_REALTIME,
            calibration: noAttempt,
            interim: {
              contentKind: 'speaker_calibration',
              endMs: 1_800,
              hypothesisId: 'late-calibration',
              revision: 9,
              startMs: 1_000,
              text: '迟到的校准临时文本',
            },
          },
        }),
      );
    });
    expect(screen.queryByText('迟到的校准临时文本')).toBeNull();
    expect(beginSpeakerCalibration).not.toHaveBeenCalled();

    act(() => {
      harness.emit(
        snapshot(recordingSession(), {
          realtime: {
            ...EMPTY_REALTIME,
            calibration: noAttempt,
            interim: {
              contentKind: 'conversation',
              endMs: 2_800,
              hypothesisId: 'conversation',
              revision: 10,
              startMs: 2_000,
              text: '边界之后的普通临时文本',
            },
          },
        }),
      );
    });
    expect(await screen.findByText('边界之后的普通临时文本')).toBeTruthy();
    expect(beginSpeakerCalibration).not.toHaveBeenCalled();
  });

  it('does not offer local calibration degradation for an authority failure', async () => {
    const noAttempt: SpeakerCalibrationSnapshot = {
      ...calibrationSnapshot('collecting'),
      attempt: null,
      status: 'not_started',
    };
    const harness = createHarness(recordingSession(), {
      realtime: {
        ...EMPTY_REALTIME,
        calibration: noAttempt,
        connection: 'unavailable',
        failureKind: 'auth',
      },
    });
    renderWorkbench(harness);

    expect(await screen.findByText('实时识别当前不可用')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ASR 降级，继续访谈' })).toBeNull();
    expect(screen.getByRole('heading', { name: '先确认两位说话人' })).toBeTruthy();
  });
});

type CompleteApi = InterviewApi & InterviewCaptureApi & SpeakerCorrectionApi;
type MockApi = { [Key in keyof CompleteApi]: ReturnType<typeof vi.fn<CompleteApi[Key]>> };
type ControllerPort = Pick<
  InterviewCaptureController,
  | 'completeFrozenAudio'
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
  suggestionApi: Partial<SuggestionApi> = {},
): {
  api: MockApi & Partial<SuggestionApi>;
  controller: ControllerPort;
  emit: (next: InterviewCaptureControllerSnapshot) => void;
} {
  let current = snapshot(serverSession, overrides);
  const listeners = new Set<(next: InterviewCaptureControllerSnapshot) => void>();
  const emit = (next: InterviewCaptureControllerSnapshot): void => {
    current =
      next.phase === 'active' && next.realtime.calibration === undefined
        ? {
            ...next,
            realtime: { ...next.realtime, calibration: calibrationSnapshot('confirmed') },
          }
        : next;
    for (const listener of listeners) listener(current);
  };
  const api = Object.assign(createApi(serverSession), suggestionApi);
  const controller: ControllerPort = {
    completeFrozenAudio: vi.fn(() => Promise.resolve(current)),
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

function renderWorkbench(
  harness: ReturnType<typeof createHarness>,
  onReturnToLogin = vi.fn(),
  navigate = vi.fn(),
  registerNavigationGuard?: (guard: ((request: WorkbenchNavigationRequest) => void) | null) => void,
): void {
  render(
    <WorkbenchShell
      api={harness.api}
      captureController={harness.controller}
      navigate={navigate}
      onReturnToLogin={onReturnToLogin}
      projectId={PROJECT_ID}
      {...(registerNavigationGuard === undefined ? {} : { registerNavigationGuard })}
      sessionId={SESSION_ID}
    />,
  );
}

function endModeHarness(
  mode: 'empty' | 'interrupted' | 'normal',
): ReturnType<typeof createHarness> {
  if (mode === 'normal') return createHarness(recordingSession());
  if (mode === 'interrupted') return createHarness(interruptedSession(), { phase: 'interrupted' });
  return createHarness(interruptedSession(), {
    archive: {
      archiveByteLength: 0,
      archiveChunkCount: 0,
      archiveHighWaterSequenceNo: -1,
      deliveryAcknowledgedHighWaterSequenceNo: -1,
      pendingDeliveryCount: 0,
      timelineEndMs: 0,
    },
    phase: 'interrupted',
  });
}

function createApi(serverSession: InterviewSessionResponse): MockApi {
  const segment = transcriptSegment();
  const correction: SpeakerRoleCorrectionResponse = {
    operation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    segment: { ...segment, corrected_speaker_role: 'elder', effective_speaker_role: 'elder' },
    speaker_role_revision: 1,
  };
  return {
    abandonEmptyCapture: vi.fn(() => Promise.resolve(serverSession)),
    completeInterviewAudio: vi.fn(() => Promise.resolve(MANIFEST)),
    correctTranscriptSpeakerRole: vi.fn(() => Promise.resolve(correction)),
    confirmCaptureActive: vi.fn(),
    createSession: vi.fn(),
    deviceCheck: vi.fn(),
    getSession: vi.fn(() => Promise.resolve(serverSession)),
    getTranscriptSegment: vi.fn(() =>
      Promise.resolve({
        ...segment,
        corrected_speaker_role: 'interviewer',
        effective_speaker_role: 'interviewer',
        speaker_role_revision: 1,
      }),
    ),
    loadPreparation: vi.fn(() => Promise.resolve(preparation(serverSession))),
    recoverSession: vi.fn(() => Promise.resolve(endingSession('stopping'))),
    reportCaptureInterrupted: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(() => Promise.resolve(endingSession('stopping'))),
    uploadInterviewChunk: vi.fn(),
  };
}

function createSuggestionApi(): SuggestionApi {
  return {
    getCurrentSuggestion: vi.fn(() => Promise.resolve(currentSuggestion('continue_listening'))),
    getSuggestionHistory: vi.fn(() =>
      Promise.resolve({
        anchor: 'synthetic-anchor',
        items: [],
        next_cursor: null,
        session_id: SESSION_ID,
      }),
    ),
    getSuggestionHistoryItem: vi.fn(),
    getSuggestionRequest: vi.fn(),
    requestNextSuggestion: vi.fn(),
  };
}

function currentSuggestion(
  kind: 'suggestion' | 'continue_listening' | 'unavailable',
  question: string | null = null,
  presentationRevision = 2,
): Awaited<ReturnType<SuggestionApi['getCurrentSuggestion']>> {
  return {
    display_sequence: kind === 'suggestion' ? presentationRevision : null,
    displayed_at: '2026-08-25T00:00:00.000Z',
    history: { has_previous: presentationRevision > 1 },
    kind,
    presentation_revision: presentationRevision,
    question,
    reason: kind === 'suggestion' ? 'Synthetic reason.' : null,
    session_id: SESSION_ID,
    snapshot_id:
      kind === 'suggestion'
        ? `${String(presentationRevision).repeat(8)}-4444-4444-8444-444444444444`
        : null,
    withdrawal_reason: null,
  };
}

function transcriptSegment(): TranscriptSegmentResponse {
  return {
    content_kind: 'conversation',
    corrected_speaker_role: null,
    corrected_text: null,
    effective_speaker_role: 'unknown',
    end_ms: 2_000,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    original_speaker_role: 'unknown',
    original_speaker_role_authority: 'unconfirmed',
    original_text: '那时我们住在河边。',
    speaker_provider_id: 'speaker_1',
    speaker_role_revision: 0,
    speaker_stream_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    start_ms: 1_000,
    trusted_effective_speaker_role: 'unknown',
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
    realtime:
      serverSession.status === 'recording'
        ? { ...EMPTY_REALTIME, calibration: calibrationSnapshot('confirmed') }
        : EMPTY_REALTIME,
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

function calibrationSnapshot(
  status: 'collecting' | 'confirmed' | 'skipped',
): SpeakerCalibrationSnapshot {
  return {
    attempt: {
      attempt_no: 1,
      boundary: {
        end_sequence_no_exclusive: status === 'collecting' ? null : 2,
        end_timeline_ms: status === 'collecting' ? null : 200,
        start_sequence_no: 0,
        start_timeline_ms: 0,
      },
      confirmed_mappings:
        status === 'confirmed'
          ? [
              {
                authority: 'user_confirmed',
                speaker_provider_id: 'speaker_1',
                speaker_role: 'interviewer',
              },
              {
                authority: 'user_confirmed',
                speaker_provider_id: 'speaker_2',
                speaker_role: 'elder',
              },
            ]
          : [],
      id: '55555555-5555-4555-8555-555555555555',
      observed_provider_labels: ['speaker_1', 'speaker_2'],
      resolved_at: status === 'collecting' ? null : VERIFIED_AT,
      started_at: VERIFIED_AT,
      status,
    },
    session_id: SESSION_ID,
    speaker_role_revision: status === 'confirmed' ? 1 : 0,
    speaker_stream: {
      audio_stream_id: '77777777-7777-4777-8777-777777777777',
      capture_generation_id: '66666666-6666-4666-8666-666666666666',
      id: '44444444-4444-4444-8444-444444444444',
      status: 'active',
    },
    status,
    updated_at: VERIFIED_AT,
  };
}

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
