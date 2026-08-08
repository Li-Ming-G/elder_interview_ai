// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InterviewSessionResponse } from '@elder-interview/contracts';

import type { InterviewApi, PreparationData } from './interview-api.js';
import { WorkbenchShell } from './workbench-shell.js';
import type { RealtimeState } from '../realtime-transcription/realtime-transport.js';
import type {
  InterviewCaptureController,
  InterviewCaptureControllerSnapshot,
} from './interview-capture-controller.js';

afterEach(cleanup);

const session: InterviewSessionResponse = {
  created_at: '2026-08-07T00:00:00.000Z',
  created_by: 'user-1',
  id: 'session-1',
  project_id: 'project-1',
  sequence_no: 1,
  started_at: '2026-08-07T00:00:00.000Z',
  status: 'recording',
  updated_at: '2026-08-07T00:00:00.000Z',
};

function data(sessionValue: InterviewSessionResponse = session): PreparationData {
  return {
    consents: [
      {
        consent_audio_object_id: null,
        consent_method: 'electronic',
        consent_text_version: 'mvp-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-07T00:00:00.000Z',
        created_at: '2026-08-07T00:00:00.000Z',
        created_by: 'user-1',
        id: 'consent-1',
        project_id: 'project-1',
        revoked_at: null,
        status: 'valid',
      },
    ],
    project: {
      approximate_age: null,
      birth_year: null,
      created_at: '2026-08-07T00:00:00.000Z',
      created_by: 'user-1',
      current_city: null,
      display_name: '林奶奶',
      id: 'project-1',
      native_place: null,
      status: 'active',
      updated_at: '2026-08-07T00:00:00.000Z',
    },
    serviceTerms: [],
    session: sessionValue,
  };
}

function api(result: PreparationData): InterviewApi {
  return {
    createSession: vi.fn(),
    deviceCheck: vi.fn(),
    loadPreparation: vi.fn().mockResolvedValue(result),
  };
}

function controllerHarness(): {
  controller: Pick<InterviewCaptureController, 'recover' | 'subscribe'>;
  emit: (state: RealtimeState) => void;
  isSubscribed: () => boolean;
} {
  let listener: ((snapshot: InterviewCaptureControllerSnapshot) => void) | null = null;
  return {
    controller: {
      recover: vi.fn(() => Promise.resolve({} as InterviewCaptureControllerSnapshot)),
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    },
    emit: (state) => listener?.({ realtime: state } as InterviewCaptureControllerSnapshot),
    isSubscribed: () => listener !== null,
  };
}

describe('WorkbenchShell', () => {
  it('fails closed when the server session is not streamable', async () => {
    const transport = controllerHarness();
    render(
      <WorkbenchShell
        api={api(data({ ...session, status: 'completed' }))}
        captureController={transport.controller}
        projectId="project-1"
        sessionId="session-1"
      />,
    );
    expect(await screen.findByText('无法进入实时工作台')).toBeTruthy();
    expect(screen.getByText(/服务端未确认/)).toBeTruthy();
  });

  it('renders speaker and finality semantics and keeps ASR failure separate from recording', async () => {
    const transport = controllerHarness();
    render(
      <WorkbenchShell
        api={api(data())}
        captureController={transport.controller}
        projectId="project-1"
        sessionId="session-1"
      />,
    );
    await screen.findByText('当前对话');
    await waitFor(() => {
      expect(transport.isSubscribed()).toBe(true);
    });
    act(() => {
      transport.emit({
        connection: 'unavailable',
        errorCode: 'ASR_UNAVAILABLE',
        failureKind: 'asr',
        finals: [
          {
            endMs: 2000,
            segmentId: 'segment-1',
            speakerRole: 'elder',
            startMs: 1000,
            text: '那时候我们住在河边。',
          },
        ],
        interim: {
          endMs: 3000,
          hypothesisId: 'h1',
          revision: 2,
          startMs: 2000,
          text: '每天都能听见',
        },
        pendingBytes: 0,
        pendingFrames: 0,
        resetRequired: false,
        resumed: false,
      });
    });
    expect(screen.getByText('长者')).toBeTruthy();
    expect(screen.getByText('那时候我们住在河边。')).toBeTruthy();
    expect(screen.getByText('每天都能听见')).toBeTruthy();
    expect(screen.getByText('实时转录暂不可用')).toBeTruthy();
    expect(screen.getByText('原始录音链路不受此状态影响。')).toBeTruthy();
  });

  it('pauses following while reviewing and reports only new finals', async () => {
    const transport = controllerHarness();
    render(
      <WorkbenchShell
        api={api(data())}
        captureController={transport.controller}
        projectId="project-1"
        sessionId="session-1"
      />,
    );
    const viewport = await screen.findByTestId('transcript-viewport');
    await waitFor(() => {
      expect(transport.isSubscribed()).toBe(true);
    });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    fireEvent.scroll(viewport);
    act(() => {
      transport.emit({
        connection: 'connected',
        errorCode: null,
        failureKind: null,
        finals: [
          {
            endMs: 1000,
            segmentId: 's1',
            speakerRole: 'interviewer',
            startMs: 0,
            text: '您还记得那条河吗？',
          },
        ],
        interim: null,
        pendingBytes: 0,
        pendingFrames: 0,
        resetRequired: false,
        resumed: false,
      });
    });
    expect(await screen.findByText('回到最新 · 1 条新内容')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /回到最新/ }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /回到最新/ })).toBeNull();
    });
  });
});
