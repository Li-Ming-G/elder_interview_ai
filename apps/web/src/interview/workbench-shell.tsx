import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  InterviewSessionResponse,
  RecoverSessionRequest,
  StopSessionRequest,
  SpeakerCalibrationMapping,
  SpeakerCalibrationSnapshot,
  TranscriptSegmentResponse,
  CorrectedSpeakerRole,
} from '@elder-interview/contracts';

import type {
  InterviewApi,
  InterviewCaptureApi,
  PreparationData,
  SpeakerCalibrationApi,
  SpeakerCorrectionApi,
} from './interview-api.js';
import { InterviewApiError } from './interview-api.js';
import { hasCurrentValidConsent } from './consent-status.js';
import type { RealtimeTranscriptFinal } from '../realtime-transcription/realtime-transport.js';
import type {
  CaptureStopHandoff,
  InterviewCaptureController,
  InterviewCaptureControllerSnapshot,
} from './interview-capture-controller.js';
import { preparationPath } from './routes.js';

interface WorkbenchShellProps {
  api: InterviewApi &
    InterviewCaptureApi &
    Partial<SpeakerCalibrationApi> &
    Partial<SpeakerCorrectionApi>;
  captureController: Pick<
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
  navigate: (path: string, replace?: boolean) => void;
  onReturnToLogin: () => void;
  projectId: string;
  sessionId: string;
}

type LoadState =
  | { kind: 'loading' }
  | { authenticationRequired: boolean; kind: 'error'; message: string }
  | { data: PreparationData; kind: 'ready' };

type EndMode = 'normal' | 'interrupted' | 'empty';
type WorkbenchState =
  | 'recording'
  | 'interrupted'
  | 'ending_local'
  | 'ending_frozen'
  | 'stopping'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'no_audio'
  | 'blocked';

export function WorkbenchShell({
  api,
  captureController,
  navigate,
  onReturnToLogin,
  projectId,
  sessionId,
}: WorkbenchShellProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [snapshot, setSnapshot] = useState(captureController.snapshot);
  const [endMode, setEndMode] = useState<EndMode | null>(null);
  const [finalizingLocal, setFinalizingLocal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusExpanded, setStatusExpanded] = useState(true);
  const [saveExpanded, setSaveExpanded] = useState(false);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [calibrationBusy, setCalibrationBusy] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const actionLock = useRef(false);
  const endTrigger = useRef<HTMLElement | null>(null);
  const reconcileRequestId = useRef<string | null>(null);
  const abandonRequestId = useRef<string | null>(null);
  const calibrationBegin = useRef<{ requestId: string; streamId: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ kind: 'loading' });
    try {
      const data = await api.loadPreparation(projectId, sessionId);
      if (data.session === null) throw new Error('SESSION_SNAPSHOT_MISSING');
      await captureController.recover(data.session);
      setAuthenticationRequired(false);
      setLoadState({ data, kind: 'ready' });
    } catch (error) {
      const authRequired = isAuthenticationRequired(error);
      if (isAuthorityFailure(error)) {
        await captureController.verifyServerSession().catch(() => undefined);
      }
      setAuthenticationRequired(authRequired);
      setLoadState({
        authenticationRequired: authRequired,
        kind: 'error',
        message: workbenchLoadError(error),
      });
    }
  }, [api, captureController, projectId, sessionId]);

  useEffect(() => captureController.subscribe(setSnapshot), [captureController]);
  useEffect(() => {
    void load();
  }, [load]);

  const verify = useCallback(async (): Promise<void> => {
    try {
      await captureController.verifyServerSession();
    } catch (error) {
      // The controller preserves the last verified snapshot and publishes the verification error.
      if (isAuthenticationRequired(error)) setAuthenticationRequired(true);
    }
  }, [captureController]);

  useEffect(() => {
    if (loadState.kind !== 'ready') return;
    const timer = globalThis.setInterval(() => void verify(), 4_000);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void verify();
    };
    const onOnline = (): void => void verify();
    globalThis.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return (): void => {
      globalThis.clearInterval(timer);
      globalThis.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadState.kind, verify]);

  useEffect(() => {
    if (
      snapshot.phase === 'interrupted' ||
      snapshot.serverSession?.capture?.interruption_reason === 'local_archive_failed'
    ) {
      setSaveExpanded(true);
    }
  }, [snapshot.phase, snapshot.serverSession?.capture?.interruption_reason]);

  const beginCalibration = useCallback(
    async (force = false): Promise<void> => {
      const calibration = snapshot.realtime.calibration;
      const streamId = calibration?.speaker_stream?.id;
      const retryable = calibration?.status === 'failed' || calibration?.status === 'skipped';
      if (
        calibration === null ||
        calibration === undefined ||
        streamId === undefined ||
        (calibration.status !== 'not_started' && !(force && retryable)) ||
        typeof api.beginSpeakerCalibration !== 'function' ||
        calibrationBusy
      ) {
        return;
      }
      if (!force && calibrationBegin.current?.streamId === streamId) return;
      calibrationBegin.current = { requestId: crypto.randomUUID(), streamId };
      setCalibrationBusy(true);
      setCalibrationError(null);
      try {
        await api.beginSpeakerCalibration(sessionId, {
          request_id: calibrationBegin.current.requestId,
          speaker_stream_id: streamId,
        });
      } catch (error) {
        setCalibrationError(readableActionError(error, '说话人确认暂时不可用，原始录音仍在继续。'));
      } finally {
        setCalibrationBusy(false);
      }
    },
    [api, calibrationBusy, sessionId, snapshot.realtime.calibration],
  );

  useEffect(() => {
    if (
      snapshot.phase === 'active' &&
      snapshot.realtime.connection === 'connected' &&
      snapshot.realtime.calibration?.status === 'not_started'
    ) {
      void beginCalibration();
    }
  }, [
    beginCalibration,
    snapshot.phase,
    snapshot.realtime.connection,
    snapshot.realtime.calibration,
  ]);

  async function resolveCalibration(
    action: 'confirm' | 'fail' | 'skip',
    mappings: SpeakerCalibrationMapping[] = [],
  ): Promise<void> {
    const attempt = snapshot.realtime.calibration?.attempt;
    if (
      attempt === null ||
      attempt === undefined ||
      typeof api.resolveSpeakerCalibration !== 'function' ||
      calibrationBusy
    ) {
      return;
    }
    setCalibrationBusy(true);
    setCalibrationError(null);
    try {
      await api.resolveSpeakerCalibration(attempt.id, {
        action,
        mappings: mappings.map(({ speaker_provider_id, speaker_role }) => ({
          speaker_provider_id,
          speaker_role,
        })),
        request_id: crypto.randomUUID(),
      });
    } catch (error) {
      setCalibrationError(readableActionError(error, '说话人确认未完成，原始录音仍在继续。'));
    } finally {
      setCalibrationBusy(false);
    }
  }

  useEffect(() => {
    const session = snapshot.serverSession;
    if (session?.status !== 'stopping' || snapshot.archive.pendingDeliveryCount === 0) {
      return;
    }
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      Reflect.set(event, 'returnValue', '');
    };
    globalThis.addEventListener('beforeunload', warn);
    return (): void => {
      globalThis.removeEventListener('beforeunload', warn);
    };
  }, [snapshot.archive.pendingDeliveryCount, snapshot.serverSession]);

  async function resumeInterview(): Promise<void> {
    if (actionLock.current) return;
    actionLock.current = true;
    setActionError(null);
    try {
      await captureController.resume();
      await captureController.verifyServerSession();
    } catch (error) {
      setActionError(readableActionError(error, '无法继续同一次访谈，请重新核对保存状态'));
    } finally {
      actionLock.current = false;
    }
  }

  async function confirmEnd(): Promise<void> {
    if (actionLock.current || endMode === null) return;
    const mode = endMode;
    setEndMode(null);
    actionLock.current = true;
    setActionError(null);
    setFinalizingLocal(true);
    try {
      if (mode === 'empty') {
        await abandonEmpty();
      } else {
        const handoff = await captureController.stopAndFreeze();
        if (handoff.expectedChunkCount < 1) {
          throw new Error('LOCAL_ARCHIVE_EMPTY_AFTER_STOP');
        }
        await submitFrozenEnd(handoff, mode);
      }
    } catch (error) {
      setActionError(readableActionError(error, '安全结束未能完成，请保留本页并重新核对'));
    } finally {
      setFinalizingLocal(false);
      actionLock.current = false;
    }
  }

  async function abandonEmpty(): Promise<void> {
    const capture = snapshot.serverSession?.capture;
    if (
      capture?.status !== 'interrupted' ||
      snapshot.archive.archiveChunkCount !== 0 ||
      snapshot.lastError === 'LOCAL_CAPTURE_JOB_MISSING'
    ) {
      throw new Error('EMPTY_CAPTURE_NOT_CONFIRMED');
    }
    abandonRequestId.current ??= globalThis.crypto.randomUUID();
    const session = await api.abandonEmptyCapture(sessionId, {
      audio_stream_id: capture.audio_stream_id,
      generation_no: capture.generation_no,
      local_archive_chunk_count: 0,
      request_id: abandonRequestId.current,
    });
    captureController.observeServerSession(session);
  }

  async function submitFrozenEnd(
    handoff: CaptureStopHandoff,
    mode: Exclude<EndMode, 'empty'>,
  ): Promise<void> {
    const request: StopSessionRequest = {
      audio_object_id: handoff.audioObjectId,
      chunks: [...handoff.chunks],
      expected_chunk_count: handoff.expectedChunkCount,
      request_id: handoff.stopRequestId,
    };
    const accepted =
      mode === 'normal'
        ? await api.stopSession(sessionId, request)
        : await api.recoverSession(sessionId, { ...request, action: 'finalize_interrupted' });
    captureController.observeServerSession(accepted);
    await finishFrozenAudio(handoff);
  }

  async function finishFrozenAudio(handoff: CaptureStopHandoff): Promise<void> {
    await captureController.flushDelivery();
    await api.completeInterviewAudio(handoff.audioObjectId, {
      expected_chunk_count: handoff.expectedChunkCount,
      request_id: handoff.completeRequestId,
    });
    await captureController.verifyServerSession();
  }

  async function continueFrozenEnd(): Promise<void> {
    if (actionLock.current) return;
    actionLock.current = true;
    setActionError(null);
    setFinalizingLocal(true);
    try {
      const handoff = await captureController.stopAndFreeze();
      const status = captureController.snapshot.serverSession?.status;
      if (status === 'recording' || status === 'reconnecting') {
        await submitFrozenEnd(handoff, 'normal');
      } else if (status === 'interrupted') {
        await submitFrozenEnd(handoff, 'interrupted');
      } else {
        await finishFrozenAudio(handoff);
      }
    } catch (error) {
      setActionError(readableActionError(error, '尚未完成安全保存，请保留本页并重新核对'));
    } finally {
      setFinalizingLocal(false);
      actionLock.current = false;
    }
  }

  async function reconcile(): Promise<void> {
    if (actionLock.current) return;
    actionLock.current = true;
    setActionError(null);
    try {
      reconcileRequestId.current ??= globalThis.crypto.randomUUID();
      const request: RecoverSessionRequest = {
        action: 'reconcile',
        request_id: reconcileRequestId.current,
      };
      const session = await api.recoverSession(sessionId, request);
      captureController.observeServerSession(session);
      if (reconcileRequestId.current === request.request_id) {
        reconcileRequestId.current = null;
      }
    } catch (error) {
      setActionError(readableActionError(error, '管理服务暂时无法继续收束，请稍后重新核对'));
    } finally {
      actionLock.current = false;
    }
  }

  if (loadState.kind === 'loading') return <WorkbenchLoading />;
  if (loadState.kind === 'error')
    return (
      <WorkbenchFailure
        message={loadState.message}
        onLeave={() => {
          navigate('/', true);
        }}
        onReturnToLogin={loadState.authenticationRequired ? onReturnToLogin : null}
        retry={load}
      />
    );
  if (snapshot.serverSession === null) {
    return (
      <WorkbenchFailure
        message="无法确认当前访谈会话。"
        onLeave={() => {
          navigate('/', true);
        }}
        onReturnToLogin={null}
        retry={load}
      />
    );
  }

  const projectName = safeProjectName(loadState.data.project.display_name);
  const validConsent = hasCurrentValidConsent(loadState.data.consents);
  const state = deriveWorkbenchState(snapshot, finalizingLocal);
  const canUseInterruptedActions =
    validConsent &&
    ['ready', 'active'].includes(loadState.data.project.status) &&
    snapshot.lastError !== 'LOCAL_CAPTURE_JOB_MISSING' &&
    snapshot.lastError !== 'AUTHORITY_LOST' &&
    snapshot.endHandoff === null;
  const canResume =
    canUseInterruptedActions && snapshot.serverSession.capture?.status === 'interrupted';
  const canFinalizeExisting = canUseInterruptedActions && snapshot.archive.archiveChunkCount > 0;
  const canAbandon =
    canUseInterruptedActions &&
    snapshot.archive.archiveChunkCount === 0 &&
    snapshot.serverSession.capture?.status === 'interrupted';

  return (
    <WorkbenchView
      actionError={actionError}
      calibrationBusy={calibrationBusy}
      calibrationError={calibrationError}
      canAbandon={canAbandon}
      canFinalizeExisting={canFinalizeExisting}
      canResume={canResume}
      endMode={endMode}
      endTrigger={endTrigger}
      authenticationRequired={authenticationRequired}
      navigate={navigate}
      onCloseEnd={() => {
        setEndMode(null);
      }}
      onConfirmEnd={() => void confirmEnd()}
      onContinueFrozen={() => void continueFrozenEnd()}
      onBeginCalibration={() => void beginCalibration(true)}
      onEnd={(mode, trigger) => {
        endTrigger.current = trigger;
        setEndMode(mode);
      }}
      onRecheck={() => void verify()}
      onReconcile={() => void reconcile()}
      onReturnToLogin={onReturnToLogin}
      onResume={() => void resumeInterview()}
      onResolveCalibration={(action, mappings) => void resolveCalibration(action, mappings)}
      projectId={projectId}
      projectName={projectName}
      saveExpanded={saveExpanded}
      setSaveExpanded={setSaveExpanded}
      setStatusExpanded={setStatusExpanded}
      snapshot={snapshot}
      state={state}
      statusExpanded={statusExpanded}
      validConsent={validConsent}
      speakerCorrections={api}
    />
  );
}

interface WorkbenchViewProps {
  actionError: string | null;
  authenticationRequired: boolean;
  calibrationBusy: boolean;
  calibrationError: string | null;
  canAbandon: boolean;
  canFinalizeExisting: boolean;
  canResume: boolean;
  endMode: EndMode | null;
  endTrigger: React.RefObject<HTMLElement | null>;
  navigate: (path: string, replace?: boolean) => void;
  onCloseEnd: () => void;
  onConfirmEnd: () => void;
  onContinueFrozen: () => void;
  onBeginCalibration: () => void;
  onEnd: (mode: EndMode, trigger: HTMLButtonElement) => void;
  onRecheck: () => void;
  onReconcile: () => void;
  onReturnToLogin: () => void;
  onResume: () => void;
  onResolveCalibration: (
    action: 'confirm' | 'fail' | 'skip',
    mappings?: SpeakerCalibrationMapping[],
  ) => void;
  projectId: string;
  projectName: string;
  saveExpanded: boolean;
  setSaveExpanded: (value: boolean) => void;
  setStatusExpanded: (value: boolean) => void;
  snapshot: InterviewCaptureControllerSnapshot;
  state: WorkbenchState;
  statusExpanded: boolean;
  validConsent: boolean;
  speakerCorrections: Partial<SpeakerCorrectionApi>;
}

function WorkbenchView(props: WorkbenchViewProps): React.JSX.Element {
  const {
    actionError,
    authenticationRequired,
    calibrationBusy,
    calibrationError,
    canAbandon,
    canFinalizeExisting,
    canResume,
    endMode,
    endTrigger,
    navigate,
    onCloseEnd,
    onConfirmEnd,
    onContinueFrozen,
    onBeginCalibration,
    onEnd,
    onRecheck,
    onReconcile,
    onReturnToLogin,
    onResume,
    onResolveCalibration,
    projectId,
    projectName,
    saveExpanded,
    setSaveExpanded,
    setStatusExpanded,
    snapshot,
    state,
    statusExpanded,
    validConsent,
    speakerCorrections,
  } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const previousFinalCount = useRef(0);
  const session = snapshot.serverSession;
  if (session === null) throw new Error('SERVER_SESSION_REQUIRED');

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return (): void => {
      globalThis.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const added = Math.max(0, snapshot.realtime.finals.length - previousFinalCount.current);
    previousFinalCount.current = snapshot.realtime.finals.length;
    if (!following && added > 0) setUnread((count) => count + added);
    if (following && typeof viewportRef.current?.scrollTo === 'function') {
      viewportRef.current.scrollTo({
        behavior: 'smooth',
        top: viewportRef.current.scrollHeight,
      });
    }
  }, [following, snapshot.realtime.finals.length, snapshot.realtime.interim?.revision]);

  function onScroll(): void {
    const node = viewportRef.current;
    if (node === null) return;
    const atLatest = node.scrollHeight - node.scrollTop - node.clientHeight < 56;
    if (atLatest !== following) {
      setFollowing(atLatest);
      if (atLatest) setUnread(0);
    }
  }

  function returnToLatest(): void {
    setFollowing(true);
    setUnread(0);
    viewportRef.current?.scrollTo({ behavior: 'smooth', top: viewportRef.current.scrollHeight });
  }

  const realtimeFailure =
    snapshot.realtime.failureKind === null ? null : failureText(snapshot.realtime.failureKind);
  const criticalSaveFailure =
    snapshot.phase === 'interrupted' ||
    snapshot.serverSession?.capture?.interruption_reason === 'local_archive_failed' ||
    snapshot.deliveryError !== null;
  const endingState = state !== 'recording' && state !== 'interrupted';
  const showStatusPanel = state === 'interrupted' || endingState;

  return (
    <main className={`workbench workbench--${state}`} data-session-id={session.id}>
      <header className="workbench-bar">
        <div className="workbench-identity">
          <strong>{projectName}</strong>
          <span>{elapsedText(session, now)}</span>
        </div>
        <p
          className={`workbench-safety${criticalSaveFailure ? ' workbench-safety--critical' : ''}`}
          role={criticalSaveFailure ? 'alert' : 'status'}
        >
          {safetySummary(snapshot, state)}
        </p>
        {state === 'recording' ? (
          <button
            className="button button--danger workbench-end"
            onClick={(event) => {
              onEnd('normal', event.currentTarget);
            }}
            type="button"
          >
            结束访谈
          </button>
        ) : null}
      </header>

      <div className="workbench-content">
        {showStatusPanel ? (
          <SessionStatePanel
            canAbandon={canAbandon}
            canFinalizeExisting={canFinalizeExisting}
            canResume={canResume}
            expanded={statusExpanded}
            authenticationRequired={authenticationRequired}
            onAbandon={(trigger) => {
              onEnd('empty', trigger);
            }}
            onContinueFrozen={onContinueFrozen}
            onFinalize={(trigger) => {
              onEnd('interrupted', trigger);
            }}
            onLeave={() => {
              navigate('/');
            }}
            onMinimize={() => {
              setStatusExpanded(false);
            }}
            onPrepareAgain={() => {
              navigate(preparationPath(projectId));
            }}
            onRecheck={onRecheck}
            onReconcile={onReconcile}
            onReturnToLogin={onReturnToLogin}
            onResume={onResume}
            onRestore={() => {
              setStatusExpanded(true);
            }}
            saveDetails={() => {
              setSaveExpanded(true);
            }}
            snapshot={snapshot}
            state={state}
            validConsent={validConsent}
          />
        ) : null}

        {state === 'recording' ? (
          <SpeakerCalibrationPanel
            busy={calibrationBusy}
            error={calibrationError}
            onBegin={onBeginCalibration}
            onResolve={onResolveCalibration}
            snapshot={snapshot.realtime.calibration}
          />
        ) : null}

        <section className="transcript-stage" aria-labelledby="transcript-title">
          <div className="transcript-heading">
            <div>
              <p className="context-label">{endingState ? '当前已加载记录' : '实时记录'}</p>
              <h1 id="transcript-title">当前对话</h1>
            </div>
            <div className="transcript-tools">
              <span className="transcript-state" role="status">
                {transcriptFact(snapshot, state)}
              </span>
              <button
                aria-expanded={saveExpanded}
                className="text-button"
                onClick={() => {
                  setSaveExpanded(!saveExpanded);
                }}
                type="button"
              >
                保存状态
              </button>
            </div>
          </div>
          {saveExpanded ? <SaveFacts snapshot={snapshot} /> : null}
          {state === 'recording' && realtimeFailure !== null ? (
            <div className="transcript-notice" role="alert">
              <strong>{realtimeFailure.title}</strong>
              <p>{realtimeFailure.detail}</p>
            </div>
          ) : null}
          {actionError === null ? null : (
            <div className="workbench-action-error" role="alert">
              <strong>操作尚未完成</strong>
              <p>{actionError}</p>
            </div>
          )}
          <div
            aria-label="访谈转录，可滚动查看"
            className="transcript-viewport"
            data-testid="transcript-viewport"
            onScroll={onScroll}
            ref={viewportRef}
            tabIndex={0}
          >
            {snapshot.realtime.finals.length === 0 && snapshot.realtime.interim === null ? (
              <div className="transcript-empty">
                <strong>{endingState ? '当前页面没有已加载的转录' : '正在倾听'}</strong>
                <p>
                  {endingState
                    ? '刷新后本页不会猜测或重建文字；完整回顾将在后续页面提供。'
                    : '确定态转录会依次出现在这里，原始录音保存不依赖文字是否出现。'}
                </p>
              </div>
            ) : null}
            <ol className="transcript-list" data-testid="workbench-finals">
              {snapshot.realtime.finals.map((segment) => (
                <TranscriptLine
                  key={segment.segmentId}
                  segment={segment}
                  sessionId={session.id}
                  speakerCorrections={speakerCorrections}
                />
              ))}
            </ol>
            {snapshot.realtime.interim === null || endingState ? null : (
              <div
                className="transcript-line transcript-line--interim"
                data-testid="workbench-interim"
              >
                <div className="transcript-meta">
                  <span className="speaker-label">识别中</span>
                  <time>{formatOffset(snapshot.realtime.interim.startMs)}</time>
                </div>
                <p>{snapshot.realtime.interim.text}</p>
              </div>
            )}
          </div>
          {!following ? (
            <button className="button return-latest" onClick={returnToLatest} type="button">
              回到最新{unread > 0 ? ` · ${String(unread)} 条新内容` : ''}
            </button>
          ) : null}
          <span className="sr-only" aria-live="polite">
            {unread > 0 ? `有 ${String(unread)} 条新的确定态转录` : ''}
          </span>
        </section>
      </div>

      {state === 'recording' ? <SuggestionSeam /> : null}
      {endMode === null ? null : (
        <EndInterviewDialog
          onCancel={onCloseEnd}
          onConfirm={onConfirmEnd}
          restoreFocus={endTrigger.current}
        />
      )}
    </main>
  );
}

function SpeakerCalibrationPanel({
  busy,
  error,
  onBegin,
  onResolve,
  snapshot,
}: {
  busy: boolean;
  error: string | null;
  onBegin: () => void;
  onResolve: (action: 'confirm' | 'fail' | 'skip', mappings?: SpeakerCalibrationMapping[]) => void;
  snapshot: SpeakerCalibrationSnapshot | null | undefined;
}): React.JSX.Element {
  const [reversed, setReversed] = useState(false);
  const attemptId = snapshot?.attempt?.id ?? null;
  useEffect(() => {
    setReversed(false);
  }, [attemptId]);

  if (snapshot?.status === 'confirmed') {
    return (
      <section className="speaker-calibration speaker-calibration--confirmed" aria-live="polite">
        <strong>正在录音 · 说话人已确认</strong>
        <span>之后的确定态文字会沿用本次人工确认。</span>
      </section>
    );
  }

  if (snapshot?.status === 'collecting' && snapshot.attempt !== null) {
    const labels = snapshot.attempt.observed_provider_labels.slice(0, 2);
    const firstLabel = labels[0];
    const secondLabel = labels[1];
    const mappings: SpeakerCalibrationMapping[] =
      firstLabel !== undefined && secondLabel !== undefined
        ? [
            {
              authority: 'user_confirmed',
              speaker_provider_id: firstLabel,
              speaker_role: reversed ? 'elder' : 'interviewer',
            },
            {
              authority: 'user_confirmed',
              speaker_provider_id: secondLabel,
              speaker_role: reversed ? 'interviewer' : 'elder',
            },
          ]
        : [];
    return (
      <section className="speaker-calibration" aria-labelledby="speaker-calibration-title">
        <div className="speaker-calibration__copy" aria-live="polite">
          <strong id="speaker-calibration-title">正在录音 · 正在确认说话人</strong>
          {labels.length < 2 ? (
            <p>
              请先由访谈员说“我是访谈员”，再请长者说“我是受访长者”。已听到 {labels.length}/2 位。
            </p>
          ) : (
            <p>
              当前对应：
              {mappings[0]?.speaker_role === 'interviewer' ? '第一位是访谈员' : '第一位是长者'}，
              {mappings[1]?.speaker_role === 'elder' ? '第二位是长者' : '第二位是访谈员'}。
            </p>
          )}
          {error === null ? null : (
            <p className="speaker-calibration__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="speaker-calibration__actions">
          {labels.length === 2 ? (
            <>
              <button
                className="button button--secondary"
                disabled={busy}
                onClick={() => {
                  setReversed((value) => !value);
                }}
                type="button"
              >
                交换对应关系
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  onResolve('confirm', mappings);
                }}
                type="button"
              >
                {busy ? '确认中…' : '确认说话人'}
              </button>
            </>
          ) : null}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              onResolve('skip');
            }}
            type="button"
          >
            暂时跳过
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              onResolve('fail');
            }}
            type="button"
          >
            无法辨认
          </button>
        </div>
      </section>
    );
  }

  const skipped = snapshot?.status === 'skipped';
  const failed = snapshot?.status === 'failed';
  return (
    <section className="speaker-calibration" aria-live="polite">
      <div className="speaker-calibration__copy">
        <strong>
          正在录音 · {skipped ? '已跳过说话人确认' : failed ? '说话人待确认' : '准备确认说话人'}
        </strong>
        <p>这不会影响原始录音；可以稍后重试。</p>
        {error === null ? null : (
          <p className="speaker-calibration__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button className="button button--secondary" disabled={busy} onClick={onBegin} type="button">
        {busy ? '正在准备…' : '重试确认'}
      </button>
    </section>
  );
}

function SessionStatePanel({
  authenticationRequired,
  canAbandon,
  canFinalizeExisting,
  canResume,
  expanded,
  onAbandon,
  onContinueFrozen,
  onFinalize,
  onLeave,
  onMinimize,
  onPrepareAgain,
  onRecheck,
  onReconcile,
  onReturnToLogin,
  onResume,
  onRestore,
  saveDetails,
  snapshot,
  state,
  validConsent,
}: {
  authenticationRequired: boolean;
  canAbandon: boolean;
  canFinalizeExisting: boolean;
  canResume: boolean;
  expanded: boolean;
  onAbandon: (trigger: HTMLButtonElement) => void;
  onContinueFrozen: () => void;
  onFinalize: (trigger: HTMLButtonElement) => void;
  onLeave: () => void;
  onMinimize: () => void;
  onPrepareAgain: () => void;
  onRecheck: () => void;
  onReconcile: () => void;
  onReturnToLogin: () => void;
  onResume: () => void;
  onRestore: () => void;
  saveDetails: () => void;
  snapshot: InterviewCaptureControllerSnapshot;
  state: WorkbenchState;
  validConsent: boolean;
}): React.JSX.Element {
  const content = stateContent(state, snapshot);
  const canMinimize = state === 'processing' || state === 'completed';
  if (!expanded && canMinimize) {
    return (
      <section className="session-status-rail" aria-live="polite">
        <span>{content.title}</span>
        <button className="text-button" onClick={onRestore} type="button">
          查看详情
        </button>
      </section>
    );
  }
  return (
    <section
      className={`session-state-panel session-state-panel--${state}`}
      aria-labelledby="session-state-title"
      aria-live="polite"
    >
      <div className="session-state-heading">
        <div>
          <p className="context-label">{content.label}</p>
          <h2 id="session-state-title">{content.title}</h2>
        </div>
        {state === 'stopping' ? (
          <button
            aria-describedby="stopping-minimize-note"
            className="text-button"
            disabled
            type="button"
          >
            暂不能收起
          </button>
        ) : canMinimize ? (
          <button className="text-button" onClick={onMinimize} type="button">
            收起状态
          </button>
        ) : null}
      </div>
      <p className="session-state-copy">{content.detail}</p>
      {state === 'stopping' ? (
        <p className="session-state-note" id="stopping-minimize-note">
          仍可能有本浏览器录音分片等待上传，请保持页面打开。
        </p>
      ) : null}
      {state === 'interrupted' && !validConsent ? (
        <p className="session-state-note" role="alert">
          最新授权或项目权限当前不允许继续或扩大保存边界。请联系项目负责人处理。
        </p>
      ) : null}
      {state === 'interrupted' && snapshot.lastError === 'LOCAL_CAPTURE_JOB_MISSING' ? (
        <p className="session-state-note" role="alert">
          本浏览器没有找到原采集作业，无法在这里继续或提交完整结束边界。管理服务已保存的证据不会被覆盖。
        </p>
      ) : null}
      {state === 'interrupted' && snapshot.lastError === 'AUTHORITY_LOST' ? (
        <p className="session-state-note" role="alert">
          登录、授权或项目权限当前无法确认，采集已经停止。本页不会允许继续或新建结束边界；请重新登录或联系项目负责人后再核对。
        </p>
      ) : null}
      {state === 'stopping' && snapshot.endHandoff === null ? (
        <p className="session-state-note" role="alert">
          本浏览器没有找到已冻结的结束交接，不能从这里补传本地录音。管理服务仍可能继续处理已收到的证据；请重新核对或联系项目负责人。
        </p>
      ) : null}
      <div className="session-state-actions">
        {state === 'interrupted' && canResume ? (
          <button className="button button--primary" onClick={onResume} type="button">
            继续同一次访谈
          </button>
        ) : null}
        {state === 'interrupted' && canFinalizeExisting ? (
          <button
            className="button button--secondary"
            onClick={(event) => {
              onFinalize(event.currentTarget);
            }}
            type="button"
          >
            安全结束已有音频
          </button>
        ) : null}
        {state === 'interrupted' && canAbandon ? (
          <button
            className="button button--secondary"
            onClick={(event) => {
              onAbandon(event.currentTarget);
            }}
            type="button"
          >
            结束无音频会话
          </button>
        ) : null}
        {state === 'ending_frozen' ? (
          <button className="button button--primary" onClick={onContinueFrozen} type="button">
            继续安全保存
          </button>
        ) : null}
        {state === 'stopping' && snapshot.endHandoff !== null ? (
          <button className="button button--primary" onClick={onContinueFrozen} type="button">
            继续安全保存
          </button>
        ) : null}
        {state === 'stopping' || state === 'processing' ? (
          <button className="button button--secondary" onClick={onReconcile} type="button">
            继续处理收尾
          </button>
        ) : null}
        <button className="button button--secondary" onClick={onRecheck} type="button">
          重新核对
        </button>
        {state === 'interrupted' && authenticationRequired ? (
          <button className="button button--secondary" onClick={onReturnToLogin} type="button">
            返回登录
          </button>
        ) : null}
        {state === 'interrupted' && snapshot.lastError === 'AUTHORITY_LOST' ? (
          <button className="button button--secondary" onClick={onLeave} type="button">
            离开工作台
          </button>
        ) : null}
        {state === 'processing' ||
        state === 'completed' ||
        state === 'failed' ||
        state === 'blocked' ? (
          <button className="button button--secondary" onClick={onLeave} type="button">
            {leaveWorkbenchLabel(state)}
          </button>
        ) : null}
        {state === 'no_audio' ? (
          <button className="button button--primary" onClick={onPrepareAgain} type="button">
            重新准备一次访谈
          </button>
        ) : null}
        <button className="text-button" onClick={saveDetails} type="button">
          查看保存明细
        </button>
      </div>
    </section>
  );
}

function EndInterviewDialog({
  onCancel,
  onConfirm,
  restoreFocus,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocus: HTMLElement | null;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const needsOpenFallback =
    typeof HTMLDialogElement === 'undefined' ||
    typeof HTMLDialogElement.prototype.showModal !== 'function';
  useEffect(() => {
    const node = dialog.current;
    if (node !== null && typeof node.showModal === 'function' && !node.open) node.showModal();
    continueButton.current?.focus();
    return (): void => restoreFocus?.focus();
  }, [restoreFocus]);
  return (
    <dialog
      aria-describedby="end-dialog-copy"
      aria-labelledby="end-dialog-title"
      className="end-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      open={needsOpenFallback}
      ref={dialog}
    >
      <h2 id="end-dialog-title">确定结束本次访谈？</h2>
      <p id="end-dialog-copy">
        确认后将停止继续录音，并安全保存已经录下的内容。本次会话不能继续追加。
      </p>
      <div className="end-dialog-actions">
        <button
          className="button button--secondary"
          onClick={onCancel}
          ref={continueButton}
          type="button"
        >
          继续访谈
        </button>
        <button className="button button--danger" onClick={onConfirm} type="button">
          确认结束
        </button>
      </div>
    </dialog>
  );
}

function SaveFacts({
  snapshot,
}: {
  snapshot: InterviewCaptureControllerSnapshot;
}): React.JSX.Element {
  const session = snapshot.serverSession;
  const finalization = session?.finalization ?? null;
  const facts = [
    {
      detail: captureFact(snapshot),
      label: '采集',
      source: '本浏览器控制器',
      verified: snapshot.serverVerifiedAt,
    },
    {
      detail: `${String(snapshot.archive.archiveChunkCount)} 段已归档 · ${String(snapshot.archive.pendingDeliveryCount)} 段待交付`,
      label: '本浏览器 archive',
      source: '浏览器持久存储',
      verified: null,
    },
    {
      detail: hasNonAuthorityDeliveryFailure(snapshot)
        ? '本浏览器录音仍保留 · 管理服务交付暂不可用，等待重试'
        : snapshot.serverVerificationError !== null
          ? '管理服务暂不可核对，保留上次事实'
          : finalization === null
            ? `已接收 ${String(session?.capture?.uploaded_chunk_count ?? 0)} 段，manifest 尚未冻结`
            : `${uploadText(finalization.upload_status)} · ${String(finalization.uploaded_chunk_count)}/${String(finalization.expected_chunk_count)} 段`,
      label: '分片与 manifest',
      source: '管理服务',
      verified: snapshot.serverVerifiedAt,
    },
    {
      detail:
        finalization === null
          ? realtimeFact(snapshot)
          : transcriptStatusText(finalization.transcript_status),
      label: '转录',
      source: finalization === null ? '实时转录连接' : '管理服务结束状态',
      verified: snapshot.serverVerifiedAt,
    },
    {
      detail: session === null ? '尚未核对' : sessionStatusText(session),
      label: '会话',
      source: '管理服务持久 snapshot',
      verified: snapshot.serverVerifiedAt,
    },
  ];
  return (
    <section className="save-facts" aria-label="保存状态明细">
      {facts.map((fact) => (
        <div key={fact.label}>
          <strong>{fact.label}</strong>
          <p>{fact.detail}</p>
          <small>
            {fact.source} ·{' '}
            {fact.verified === null ? '随本地变化核对' : `最后核验 ${formatClock(fact.verified)}`}
          </small>
        </div>
      ))}
    </section>
  );
}

function TranscriptLine({
  segment,
  sessionId,
  speakerCorrections,
}: {
  segment: RealtimeTranscriptFinal;
  sessionId: string;
  speakerCorrections: Partial<SpeakerCorrectionApi>;
}): React.JSX.Element {
  const labels = { elder: '长者', interviewer: '倾听员', unknown: '待确认' } as const;
  const accessibleLabels = {
    elder: '长者',
    interviewer: '倾听员',
    unknown: '说话人待确认',
  } as const;
  const [canonical, setCanonical] = useState<TranscriptSegmentResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState<CorrectedSpeakerRole>(segment.speakerRole);
  const [announcement, setAnnouncement] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);
  const effectiveRole = canonical?.effective_speaker_role ?? segment.speakerRole;
  const revision = canonical?.speaker_role_revision ?? segment.speakerRoleRevision;

  useEffect(() => {
    if (!editing) setSelectedRole(effectiveRole);
  }, [editing, effectiveRole]);

  useEffect(() => {
    if (editing) selectRef.current?.focus();
  }, [editing]);

  async function saveCorrection(): Promise<void> {
    if (
      busy ||
      revision === undefined ||
      typeof speakerCorrections.correctTranscriptSpeakerRole !== 'function'
    ) {
      return;
    }
    setBusy(true);
    setAnnouncement('正在保存角色修正');
    try {
      const response = await speakerCorrections.correctTranscriptSpeakerRole(segment.segmentId, {
        corrected_speaker_role: selectedRole,
        expected_speaker_role_revision: revision,
        request_id: crypto.randomUUID(),
      });
      setCanonical(response.segment);
      setEditing(false);
      setAnnouncement(`角色已修正为${accessibleLabels[response.segment.effective_speaker_role]}`);
    } catch (error) {
      if (
        error instanceof InterviewApiError &&
        error.code === 'SPEAKER_ROLE_VERSION_CONFLICT' &&
        typeof speakerCorrections.getTranscriptSegment === 'function'
      ) {
        try {
          const latest = await speakerCorrections.getTranscriptSegment(
            sessionId,
            segment.segmentId,
          );
          setCanonical(latest);
          setSelectedRole(latest.effective_speaker_role);
          setAnnouncement('角色已由其他操作更新，已重新读取服务端事实，请核对后再保存');
        } catch (reloadError) {
          setAnnouncement(readableActionError(reloadError, '无法重新读取最新角色，请稍后重试'));
        }
      } else {
        setAnnouncement(readableActionError(error, '角色修正暂时未保存，请稍后重试'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`transcript-line transcript-line--${effectiveRole}`}
      data-segment-id={segment.segmentId}
    >
      <div className="transcript-meta">
        <span
          aria-label={
            segment.contentKind === 'speaker_calibration'
              ? '说话人校准控制片段'
              : accessibleLabels[effectiveRole]
          }
          className="speaker-label"
        >
          {segment.contentKind === 'speaker_calibration' ? '校准片段' : labels[effectiveRole]}
        </span>
        <time>{formatOffset(segment.startMs)}</time>
      </div>
      <div className="transcript-content">
        <p>{segment.text}</p>
        {typeof speakerCorrections.correctTranscriptSpeakerRole !== 'function' ||
        revision === undefined ? null : editing ? (
          <div className="speaker-correction" aria-label="修正本段说话人角色">
            <label htmlFor={`speaker-role-${segment.segmentId}`}>角色</label>
            <select
              disabled={busy}
              id={`speaker-role-${segment.segmentId}`}
              onChange={(event) => {
                setSelectedRole(event.target.value as CorrectedSpeakerRole);
              }}
              ref={selectRef}
              value={selectedRole}
            >
              <option value="elder">长者</option>
              <option value="interviewer">倾听员</option>
              <option value="unknown">待确认</option>
            </select>
            <button
              className="button button--secondary speaker-correction__save"
              disabled={busy}
              onClick={() => void saveCorrection()}
              type="button"
            >
              {busy ? '保存中' : '保存'}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setSelectedRole(effectiveRole);
                setAnnouncement('');
              }}
              type="button"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className="speaker-correction__trigger"
            onClick={() => {
              setEditing(true);
              setAnnouncement('');
            }}
            type="button"
          >
            修正角色
          </button>
        )}
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </div>
    </li>
  );
}

function SuggestionSeam(): React.JSX.Element {
  return (
    <aside className="suggestion-seam" aria-labelledby="suggestion-title">
      <div>
        <p className="context-label">下一步</p>
        <h2 id="suggestion-title">继续倾听</h2>
      </div>
      <p>长者正在讲述时，不必急着追问。建议能力接入前，这里不会显示不能使用的操作。</p>
    </aside>
  );
}

function WorkbenchLoading(): React.JSX.Element {
  return (
    <main className="workbench-loading" aria-busy="true">
      <div className="skeleton skeleton--label" />
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--panel" />
      <span className="sr-only">正在核对访谈会话、浏览器归档与授权</span>
    </main>
  );
}

function WorkbenchFailure({
  message,
  onLeave,
  onReturnToLogin,
  retry,
}: {
  message: string;
  onLeave: () => void;
  onReturnToLogin: (() => void) | null;
  retry: () => Promise<void>;
}): React.JSX.Element {
  return (
    <main className="interview-page interview-page--centered">
      <section className="load-failure">
        <p className="context-label">访谈工作台</p>
        <h1>暂时无法核对访谈事实</h1>
        <p role="alert">{message}</p>
        <button className="button button--secondary" onClick={() => void retry()} type="button">
          重新核对
        </button>
        {onReturnToLogin === null ? null : (
          <button className="button button--secondary" onClick={onReturnToLogin} type="button">
            返回登录
          </button>
        )}
        <button className="button button--secondary" onClick={onLeave} type="button">
          离开工作台
        </button>
      </section>
    </main>
  );
}

function deriveWorkbenchState(
  snapshot: InterviewCaptureControllerSnapshot,
  finalizingLocal: boolean,
): WorkbenchState {
  if (finalizingLocal) return 'ending_local';
  const session = snapshot.serverSession;
  if (session?.capture_failure_code === 'NO_AUDIO_CAPTURED') return 'no_audio';
  if (
    snapshot.endHandoff !== null &&
    (session?.status === 'recording' ||
      session?.status === 'reconnecting' ||
      session?.status === 'interrupted')
  ) {
    return 'ending_frozen';
  }
  if (session?.status === 'stopping') return 'stopping';
  if (session?.status === 'processing') return 'processing';
  if (session?.status === 'completed') return 'completed';
  if (session?.status === 'failed') return 'failed';
  if (session?.status === 'interrupted' || snapshot.phase === 'interrupted') return 'interrupted';
  if (session?.status === 'recording' || session?.status === 'reconnecting') return 'recording';
  return 'blocked';
}

function stateContent(
  state: WorkbenchState,
  snapshot: InterviewCaptureControllerSnapshot,
): { detail: string; label: string; title: string } {
  const finalization = snapshot.serverSession?.finalization ?? null;
  const content: Record<WorkbenchState, { detail: string; label: string; title: string }> = {
    blocked: {
      detail:
        '管理服务没有确认本次访谈正在采集。本页保持只读，不会申请麦克风或创建新的会话与录音对象。',
      label: '未确认采集中',
      title: '请重新核对访谈状态',
    },
    completed: {
      detail: completedDetail(snapshot.serverSession),
      label: '访谈已结束',
      title: finalization?.transcript_status === 'drained' ? '录音和转录已完成' : '录音已安全保存',
    },
    ending_frozen: {
      detail:
        '本浏览器已经停止录音并冻结结束边界，但仍需把该边界提交或补齐到管理服务。不能继续追加录音。',
      label: '结束边界已冻结',
      title: '继续完成安全保存',
    },
    ending_local: {
      detail: '正在停止录音并等待最后一段写入本浏览器。完成之前不会向管理服务宣布 stopping。',
      label: '本浏览器正在收尾',
      title: '正在整理最后一段录音',
    },
    failed: {
      detail:
        finalization?.upload_status === 'complete'
          ? '管理服务确认录音 manifest 完整，但自动收束仍需要人工处置。已保存证据不会被覆盖。'
          : '管理服务确认本次收束无法自动完成，录音 manifest 尚未确认完整。请保留本页事实并联系项目负责人。',
      label: '需要人工处置',
      title: '本次访谈未能自动收束',
    },
    interrupted: {
      detail: interruptionDetail(snapshot),
      label: '采集已中断',
      title: '先保护已经录下的内容',
    },
    no_audio: {
      detail: '管理服务已确认本次会话没有可保存的原始录音或转录。本结果不是“保存完成”。',
      label: '会话已结束',
      title: '没有录到可保存的内容',
    },
    processing: {
      detail:
        '管理服务已确认录音 manifest 完整，现在只在收束转录。可以安全离开，也可以留在本页查看当前已加载文字。',
      label: '录音已安全保存',
      title: '正在完成转录处理',
    },
    recording: { detail: '', label: '', title: '' },
    stopping: {
      detail: '结束边界已由管理服务接受，仍在等待承诺范围内的分片与 manifest 完整核验。',
      label: '请保持页面打开',
      title: '正在安全保存录音',
    },
  };
  return content[state];
}

function safetySummary(
  snapshot: InterviewCaptureControllerSnapshot,
  state: WorkbenchState,
): string {
  const archive = snapshot.archive;
  const finalization = snapshot.serverSession?.finalization ?? null;
  if (state === 'no_audio') return '未录到可保存内容';
  if (state === 'blocked') return '管理服务未确认正在采集';
  if (snapshot.serverSession?.capture?.interruption_reason === 'local_archive_failed') {
    return '本浏览器保存失败 · 请立即处置';
  }
  if (state === 'interrupted') {
    return archive.archiveChunkCount > 0
      ? `采集已中断 · 本浏览器保留 ${String(archive.archiveChunkCount)} 段`
      : '采集已中断 · 尚未发现本地录音';
  }
  if (hasNonAuthorityDeliveryFailure(snapshot)) {
    return '本浏览器仍在保存 · 管理服务交付暂不可用';
  }
  if (snapshot.serverVerificationError !== null && snapshot.phase === 'active') {
    return '本浏览器仍在保存 · 管理服务暂不可核对';
  }
  if (state === 'recording') {
    return archive.archiveChunkCount > 0
      ? `正在采集 · 本浏览器已保存 ${String(archive.archiveChunkCount)} 段`
      : '正在采集 · 本浏览器准备保存';
  }
  if (
    state === 'completed' &&
    finalization?.upload_status === 'complete' &&
    archive.archiveChunkCount === finalization.expected_chunk_count
  ) {
    return '本浏览器与管理服务均已保存';
  }
  if (state === 'failed' && finalization?.upload_status !== 'complete') {
    return '录音完整性未确认 · 需要人工处置';
  }
  return state === 'processing' || state === 'completed'
    ? '管理服务已确认录音完整'
    : '录音已停止 · 正在核对保存';
}

function leaveWorkbenchLabel(state: WorkbenchState): string {
  if (state === 'completed') return '完成并离开';
  if (state === 'processing') return '安全离开';
  if (state === 'failed') return '保留现状并离开';
  return '离开工作台';
}

function isAuthenticationRequired(error: unknown): boolean {
  return (
    error instanceof InterviewApiError && (error.status === 401 || error.code === 'AUTH_REQUIRED')
  );
}

function isAuthorityFailure(error: unknown): boolean {
  return (
    error instanceof InterviewApiError &&
    (error.status === 401 ||
      error.status === 403 ||
      ['AUTH_REQUIRED', 'FORBIDDEN', 'CONSENT_REQUIRED', 'SERVICE_TERM_REQUIRED'].includes(
        error.code,
      ))
  );
}

function hasNonAuthorityDeliveryFailure(snapshot: InterviewCaptureControllerSnapshot): boolean {
  return (
    snapshot.deliveryError !== null &&
    snapshot.lastError !== 'AUTHORITY_LOST' &&
    !['AUTH_REQUIRED', 'FORBIDDEN', 'CONSENT_REQUIRED', 'SERVICE_TERM_REQUIRED'].includes(
      snapshot.deliveryError,
    )
  );
}

function interruptionDetail(snapshot: InterviewCaptureControllerSnapshot): string {
  const reason = snapshot.serverSession?.capture?.interruption_reason;
  const reasonText = {
    auth_lost: '登录、授权或项目权限发生变化',
    capture_start_failed: '继续采集时未能重新建立麦克风',
    local_archive_failed: '本浏览器无法继续可靠写入录音',
    microphone_ended: '麦克风输入已停止',
    page_recovery_detected: '页面刷新或恢复时检测到原采集中断',
    recorder_error: '浏览器录音器发生错误',
    unknown: '采集意外停止',
  }[reason ?? 'unknown'];
  return `${reasonText}。已加载的转录保持只读；转录可能不完整，但不会覆盖已经保存的原始录音。`;
}

function captureFact(snapshot: InterviewCaptureControllerSnapshot): string {
  if (snapshot.phase === 'active') return '麦克风与归档采集正在运行';
  if (snapshot.phase === 'interrupted') return '采集已停止，等待用户处置';
  if (snapshot.endHandoff !== null) return '采集已停止，结束边界已冻结';
  return `控制器状态：${snapshot.phase}`;
}

function realtimeFact(snapshot: InterviewCaptureControllerSnapshot): string {
  if (snapshot.realtime.failureKind !== null) return '实时转录异常，原始录音不受影响';
  return connectionText(snapshot);
}

function transcriptFact(
  snapshot: InterviewCaptureControllerSnapshot,
  state: WorkbenchState,
): string {
  const finalization = snapshot.serverSession?.finalization;
  if (finalization !== null && finalization !== undefined) {
    return transcriptStatusText(finalization.transcript_status);
  }
  if (state !== 'recording') return '当前已加载文字只读';
  return connectionText(snapshot);
}

function connectionText(snapshot: InterviewCaptureControllerSnapshot): string {
  const state = snapshot.realtime;
  if (state.connection === 'connected') return state.resumed ? '转录已恢复' : '实时转录';
  if (state.connection === 'reconnecting') return '转录正在重连';
  if (state.connection === 'connecting') return '转录正在连接';
  return state.connection === 'unavailable' ? '实时转录不可用' : '实时转录已关闭';
}

function completedDetail(session: InterviewSessionResponse | null): string {
  const status = session?.finalization?.transcript_status;
  if (status === 'drained') return '管理服务确认原始录音和结束转录均已完成。';
  if (status === 'degraded')
    return '原始录音已安全保存；实时转录未能完整收束，可在后续流程补处理。';
  if (status === 'not_started') return '原始录音已安全保存；本次没有启动结束转录处理。';
  return '管理服务已确认本次访谈完成。';
}

function uploadText(
  status: NonNullable<InterviewSessionResponse['finalization']>['upload_status'],
): string {
  return {
    awaiting_upload: '等待分片',
    complete: 'manifest 完整',
    unrecoverable: 'manifest 无法自动恢复',
    verifying: '正在核验 manifest',
  }[status];
}

function transcriptStatusText(
  status: NonNullable<InterviewSessionResponse['finalization']>['transcript_status'],
): string {
  return {
    degraded: '转录已降级，录音不受影响',
    drained: '转录已完整收束',
    draining: '正在收束最后转录',
    not_started: '未启动结束转录处理',
    pending: '等待转录收束',
  }[status];
}

function sessionStatusText(session: InterviewSessionResponse): string {
  const labels: Record<InterviewSessionResponse['status'], string> = {
    completed: '已完成',
    created: '待设备检查',
    device_check: '设备检查完成',
    failed: session.capture_failure_code === 'NO_AUDIO_CAPTURED' ? '无音频终结' : '需要人工处置',
    interrupted: '采集已中断',
    processing: '录音完整，正在处理转录',
    reconnecting: '采集正在恢复',
    recording: '采集中',
    stopping: '正在安全保存',
  };
  return labels[session.status];
}

function elapsedText(session: InterviewSessionResponse, now: number): string {
  if (session.duration_seconds != null) return `实际 ${formatDuration(session.duration_seconds)}`;
  if (session.started_at === null) return '尚未开始计时';
  const seconds = Math.max(0, Math.floor((now - new Date(session.started_at).getTime()) / 1000));
  return `已进行 ${formatDuration(seconds)}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function formatOffset(milliseconds: number): string {
  return formatDuration(Math.floor(milliseconds / 1000));
}

function formatClock(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(date);
}

function safeProjectName(value: string): string {
  const normalized = value.trim();
  return normalized.length === 0 || /^[?？�\s]+$/u.test(normalized) ? '这位长者' : normalized;
}

function workbenchLoadError(error: unknown): string {
  if (error instanceof InterviewApiError) return error.message;
  if (error instanceof Error && error.message === 'SESSION_SNAPSHOT_MISSING') {
    return '管理服务没有返回本次访谈会话，请从准备页重新核对。';
  }
  return error instanceof Error ? error.message : '无法核对当前会话，请稍后重试。';
}

function readableActionError(error: unknown, fallback: string): string {
  if (error instanceof InterviewApiError) return error.message;
  if (error instanceof Error) {
    const messages: Record<string, string> = {
      CAPTURE_NOT_INTERRUPTED: '管理服务未确认当前采集可以恢复，请先重新核对。',
      EMPTY_CAPTURE_NOT_CONFIRMED: '本浏览器无法证明这是无音频会话，请先重新核对已有证据。',
      END_HANDOFF_ALREADY_FROZEN: '结束边界已经冻结，不能继续录音；请继续完成安全保存。',
      INTERVIEW_CAPTURE_JOB_NOT_FOUND: '本浏览器没有找到原采集作业，不能伪造恢复或结束边界。',
      LOCAL_ARCHIVE_EMPTY_AFTER_STOP: '最后写入后仍没有本地录音分片，请重新核对并联系项目负责人。',
    };
    return messages[error.message] ?? fallback;
  }
  return fallback;
}

function failureText(
  kind: NonNullable<InterviewCaptureControllerSnapshot['realtime']['failureKind']>,
): {
  detail: string;
  title: string;
} {
  const details = {
    asr: ['实时转录暂不可用', '原始录音继续由本浏览器保存，不受此状态影响。'],
    auth: ['登录状态已失效', '采集已停止；请重新登录后核对已保存事实。'],
    internal: ['实时转录服务暂时异常', '原始录音继续由本浏览器保存，不受此状态影响。'],
    permission: ['当前账号已无权继续', '采集已停止，请联系项目负责人处理。'],
    reset: ['短时转录恢复窗口已失效', '本页不猜测缺失文字；原始录音保存不受影响。'],
    session: ['会话当前不可流式', '管理服务已拒绝继续实时转录，请核对会话状态。'],
  } as const;
  return { detail: details[kind][1], title: details[kind][0] };
}
