import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone'],
});

test('ordinary listener completes the first interview from Home through Review and back', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installDeterministicBrowserMedia(page);
  await login(page);

  await expect(page.getByRole('button', { name: '新建访谈', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '新建访谈', exact: true }).click();
  await expect(page).toHaveURL(/\/interviews\/new\?mode=new$/u);
  await expect(page.getByRole('heading', { name: '最低项目信息' })).toBeVisible();
  await expectNoDeadPage(page);

  const projectName = `虚构全流程长者-${String(Date.now())}`;
  await page.getByLabel('姓名、昵称或项目代号').fill(projectName);
  await page.getByRole('button', { name: '创建项目并继续' }).click();
  await expect(page.getByRole('heading', { name: '建立本次访谈会话' })).toBeVisible();
  await expectNoDeadPage(page);

  await page.getByRole('button', { name: '建立会话并检查麦克风' }).click();
  await expect(page.getByRole('heading', { name: '完整朗读，再请长者明确同意' })).toBeVisible();
  await expect(page.getByRole('button', { name: '录制授权' })).toBeDisabled();
  await page.getByRole('button', { name: '检查当前页麦克风' }).click();
  await expect(page.getByText(/当前页麦克风检查通过/u)).toBeVisible();
  await expect(page.getByRole('button', { name: '录制授权' })).toBeEnabled();

  await page.getByRole('button', { name: '录制授权' }).click();
  await expect(page.getByText(/正在录制 · 已可靠暂存 [1-9]\d* 个分片/u)).toBeVisible();
  await page.getByRole('button', { name: '停止并保存授权录音' }).click();
  await expect(page.getByText(/授权录音已完整保存/u)).toBeVisible();
  await page.getByRole('button', { name: '确认并登记正式授权' }).click();
  await expect(
    page.getByRole('heading', { name: '开始本次访谈前，请再次向长者说明' }),
  ).toBeVisible();
  await expect(
    page.getByText('本次仍会录音、转录并由 AI 辅助分析；长者可随时要求停止或撤回。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '开始访谈' }).click();

  const formalIdentity = await readActiveWorkflowIdentity(page);
  const sessionId = formalIdentity.sessionId;
  expect(sessionId).not.toBeNull();
  if (sessionId === null) {
    throw new Error('formal interview session identity was not persisted');
  }
  await expect(page).toHaveURL(
    new RegExp(`/projects/[^/]+/interview/${sessionId}/workbench$`, 'u'),
  );
  await expect(page.getByRole('heading', { name: '先确认两位说话人' })).toBeVisible();
  await releaseDeterministicPcmFrames(page);
  await expect(page.getByRole('button', { name: '确认说话人' })).toBeVisible();
  await expectNoDeadPage(page);

  await page.getByRole('button', { name: '确认说话人' }).click();
  await expect(page.getByRole('heading', { name: '当前对话' })).toBeVisible();
  await expect(page.getByTestId('suggestion-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: '结束访谈' })).toBeEnabled();
  await expectNoDeadPage(page);

  const nextQuestionRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && /\/suggestions\/next$/u.test(new URL(request.url()).pathname),
  );
  await expect(page.getByRole('button', { name: '下一个问题' })).toBeEnabled();
  await page.getByRole('button', { name: '下一个问题' }).click();
  await nextQuestionRequest;
  await expect(page.getByText('建议继续倾听', { exact: true })).toBeVisible();

  await endFormalInterview(page);
  await expect(page.locator('.completion-page')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看回顾' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回工作区' })).toBeVisible();
  await page.getByRole('button', { name: '查看回顾' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/[^/]+/interview/${sessionId}/review$`, 'u'));
  await expect(page.getByText('已结束访谈 · 只读回顾')).toBeVisible();
  await expect(page.getByRole('heading', { name: /访谈回顾|第 \d+ 次访谈/u })).toBeVisible();
  await expectNoDeadPage(page);

  await page.getByRole('button', { name: '返回工作区' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 B' })).toBeVisible();
  const project = page.locator('article.project-group').filter({ hasText: projectName });
  await expect(project).toBeVisible();
  await expect(project.getByText('访谈已结束', { exact: true })).toBeVisible();
  await expect(project.getByRole('button', { name: '查看回顾' })).toBeVisible();
  await expect(project.getByRole('button', { name: '继续准备' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '继续未完成访谈' })).toHaveCount(0);
  await expectNoDeadPage(page);
});

test('new intent exposes an explicit continue choice and preserves workflow identity', async ({
  page,
}) => {
  await installDeterministicBrowserMedia(page);
  await login(page);
  await page.getByRole('button', { name: '新建访谈', exact: true }).click();
  await page.getByLabel('姓名、昵称或项目代号').fill('虚构未完成本地流程');
  const before = await readActiveWorkflowIdentity(page);
  await page.getByRole('button', { name: '返回工作区' }).click();
  await expect(page.getByRole('button', { name: '继续未完成访谈' })).toBeVisible();

  await page.getByRole('button', { name: '放弃未完成访谈并新建', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已有一条未完成访谈' })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续未完成访谈' })).toBeVisible();
  await expect(page.getByLabel('姓名、昵称或项目代号')).toHaveCount(0);
  await page.getByRole('button', { name: '继续未完成访谈' }).click();
  await expect(page.getByLabel('姓名、昵称或项目代号')).toHaveValue('虚构未完成本地流程');
  const after = await readActiveWorkflowIdentity(page);
  expect(after.workflowId).toBe(before.workflowId);
  expect(after.step).toBe('project');
});

test('server-backed pre-start discard retires the browser recovery pointer', async ({ page }) => {
  await installDeterministicBrowserMedia(page);
  await login(page);
  await page.getByRole('button', { name: '新建访谈', exact: true }).click();
  await page.getByLabel('姓名、昵称或项目代号').fill('虚构待放弃服务端流程');
  await page.getByRole('button', { name: '创建项目并继续' }).click();
  await expect(page.getByRole('heading', { name: '建立本次访谈会话' })).toBeVisible();
  const discardedWorkflow = await readActiveWorkflowIdentity(page);
  await page.getByRole('button', { name: '返回工作区' }).click();

  await expect(page.getByRole('button', { name: '放弃未完成访谈并新建' })).toBeVisible();
  await page.getByRole('button', { name: '放弃未完成访谈并新建', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已有一条未完成访谈' })).toBeVisible();
  await page.getByRole('button', { name: '放弃未完成访谈并新建' }).click();
  await expect(page.getByRole('heading', { name: '最低项目信息' })).toBeVisible();
  await expect(page.getByLabel('姓名、昵称或项目代号')).toHaveValue('');
  const freshWorkflow = await readActiveWorkflowIdentity(page);
  expect(freshWorkflow.workflowId).not.toBe(discardedWorkflow.workflowId);
  expect(freshWorkflow.projectId).toBeNull();
  expect(freshWorkflow.step).toBe('project');

  await page.getByRole('button', { name: '返回工作区' }).click();
  await expect(
    page.getByRole('button', { name: '放弃未完成访谈并新建', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '继续未完成访谈' })).toBeVisible();
});

test('refresh before formal start requires a fresh microphone check and keeps identity', async ({
  page,
}) => {
  await installDeterministicBrowserMedia(page);
  await login(page);
  await page.getByRole('button', { name: '新建访谈', exact: true }).click();
  await page.getByLabel('姓名、昵称或项目代号').fill('虚构刷新恢复流程');
  await page.getByRole('button', { name: '创建项目并继续' }).click();
  await page.getByRole('button', { name: '建立会话并检查麦克风' }).click();
  const before = await readActiveWorkflowIdentity(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: '完整朗读，再请长者明确同意' })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查当前页麦克风' })).toBeVisible();
  await expect(page.getByRole('button', { name: '录制授权' })).toBeDisabled();
  await page.getByRole('button', { name: '检查当前页麦克风' }).click();
  await expect(page.getByText(/当前页麦克风检查通过/u)).toBeVisible();
  const after = await readActiveWorkflowIdentity(page);
  expect(after.workflowId).toBe(before.workflowId);
  expect(after.projectId).toBe(before.projectId);
  expect(after.sessionId).toBe(before.sessionId);

  await page.getByRole('button', { name: '返回工作区' }).click();
  await expect(
    page.getByRole('button', { name: '放弃未完成访谈并新建', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '放弃未完成访谈并新建', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已有一条未完成访谈' })).toBeVisible();
  await page.getByRole('button', { name: '放弃未完成访谈并新建', exact: true }).click();
  await expect(page.getByRole('heading', { name: '最低项目信息' })).toBeVisible();
});

test('calibration skip keeps recording usable, exposes suggestion retry, and guards Back', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installDeterministicBrowserMedia(page);
  let suggestionReads = 0;
  await page.route('**/api/v1/sessions/*/suggestions/current', async (route) => {
    suggestionReads += 1;
    if (suggestionReads === 1) {
      await route.fulfill({
        contentType: 'application/json',
        json: { code: 'AI_PROVIDER_UNAVAILABLE', message: 'synthetic suggestion failure' },
        status: 503,
      });
      return;
    }
    const sessionId = new URL(route.request().url()).pathname.split('/')[4];
    await route.fulfill({ json: emptySuggestion(sessionId) });
  });
  await login(page);
  await startFormalInterviewFromHome(page, '虚构校准跳过流程');
  await expect(page.getByRole('heading', { name: '先确认两位说话人' })).toBeVisible();
  await expect(page.getByRole('button', { name: '暂时跳过' })).toBeVisible();
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await expect(page.getByRole('heading', { name: '当前对话' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '问题建议暂不可用' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新加载问题建议' })).toBeVisible();
  await page.getByRole('button', { name: '重新加载问题建议' }).click();
  await expect(page.getByRole('button', { name: '重新加载问题建议' })).toHaveCount(0);
  await expect(page.locator('.transcript-line').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '结束访谈' })).toBeEnabled();

  await page.goBack();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: '访谈正在进行' })).toBeVisible();
  await expect(page.getByRole('button', { name: '留在访谈中' })).toBeFocused();
  await page.getByRole('button', { name: '留在访谈中' }).click();
  await expect(page).toHaveURL(/\/workbench$/u);
  await expect(page.getByRole('heading', { name: '当前对话' })).toBeVisible();
  await endFormalInterview(page);
  await expect(page.locator('.completion-page')).toBeVisible();
});

test('calibration keeps a safe End Interview action before speaker confirmation', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installDeterministicBrowserMedia(page);
  await login(page);
  await startFormalInterviewFromHome(page, '虚构校准结束流程');
  await expect(page.getByRole('heading', { name: '先确认两位说话人' })).toBeVisible();
  await expect(page.getByRole('button', { name: '结束访谈' })).toBeEnabled();
  await endFormalInterview(page);
  await expect(page.locator('.completion-page')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看回顾' })).toBeVisible();
});

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('listener-b@example.test');
  await page.getByLabel('密码').fill('Fictional-only-Password-42!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 B' })).toBeVisible();
}

async function startFormalInterviewFromHome(page: Page, projectName: string): Promise<void> {
  await page.getByRole('button', { name: '新建访谈', exact: true }).click();
  await page.getByLabel('姓名、昵称或项目代号').fill(projectName);
  await page.getByRole('button', { name: '创建项目并继续' }).click();
  await page.getByRole('button', { name: '建立会话并检查麦克风' }).click();
  await page.getByRole('button', { name: '检查当前页麦克风' }).click();
  await expect(page.getByText(/当前页麦克风检查通过/u)).toBeVisible();
  await page.getByRole('button', { name: '录制授权' }).click();
  await expect(page.getByText(/正在录制 · 已可靠暂存 [1-9]\d* 个分片/u)).toBeVisible();
  await page.getByRole('button', { name: '停止并保存授权录音' }).click();
  await expect(page.getByText(/授权录音已完整保存/u)).toBeVisible();
  await page.getByRole('button', { name: '确认并登记正式授权' }).click();
  await expect(
    page.getByRole('heading', { name: '开始本次访谈前，请再次向长者说明' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '开始访谈' }).click();
  await expect(page).toHaveURL(/\/workbench$/u);
  await expect(page.getByRole('heading', { name: '先确认两位说话人' })).toBeVisible();
  await releaseDeterministicPcmFrames(page);
}

async function endFormalInterview(page: Page): Promise<void> {
  await page.getByRole('button', { name: '结束访谈' }).click();
  await expect(page.getByRole('heading', { name: '确定结束本次访谈？' })).toBeVisible();
  await page.getByRole('button', { name: '确认结束' }).click();
  await expect(page.locator('.completion-page')).toBeVisible();
}

async function releaseDeterministicPcmFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controls = globalThis as typeof globalThis & {
      __elderInterviewReleasePcmFrames?: () => void;
    };
    controls.__elderInterviewReleasePcmFrames?.();
  });
}

async function installDeterministicBrowserMedia(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let pcmFramesReleased = false;
    const pendingPcmNodes = new Set<{ emitFrames: () => void }>();
    const controls = globalThis as typeof globalThis & {
      __elderInterviewReleasePcmFrames?: () => void;
    };
    controls.__elderInterviewReleasePcmFrames = (): void => {
      pcmFramesReleased = true;
      for (const node of pendingPcmNodes) node.emitFrames();
    };

    class SyntheticTrack {
      public readyState: MediaStreamTrackState = 'live';
      private readonly listeners = new Map<string, Set<EventListener>>();

      public addEventListener(type: string, listener: EventListener): void {
        const listeners = this.listeners.get(type) ?? new Set<EventListener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      public removeEventListener(type: string, listener: EventListener): void {
        this.listeners.get(type)?.delete(listener);
      }

      public stop(): void {
        if (this.readyState === 'ended') return;
        this.readyState = 'ended';
        for (const listener of this.listeners.get('ended') ?? []) listener(new Event('ended'));
      }
    }

    class SyntheticStream {
      private readonly track = new SyntheticTrack();
      public getAudioTracks(): SyntheticTrack[] {
        return [this.track];
      }
      public getTracks(): SyntheticTrack[] {
        return [this.track];
      }
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: (): Promise<SyntheticStream> => Promise.resolve(new SyntheticStream()),
      },
    });

    class SyntheticAnalyser {
      public fftSize = 1024;
      private sampleReads = 0;
      public getByteTimeDomainData(samples: Uint8Array): void {
        samples.fill(128);
        this.sampleReads += 1;
        if (this.sampleReads > 40) samples.fill(200);
      }
      public disconnect(): void {}
    }

    class SyntheticAudioContext {
      public readonly audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };
      public createAnalyser(): SyntheticAnalyser {
        return new SyntheticAnalyser();
      }
      public createMediaStreamSource(): {
        connect: (destination: unknown) => void;
        disconnect: () => void;
      } {
        return {
          connect: (destination): void => {
            if (typeof (destination as { emitFrames?: () => void }).emitFrames === 'function') {
              (destination as { emitFrames: () => void }).emitFrames();
            }
          },
          disconnect: (): void => undefined,
        };
      }
      public close(): Promise<void> {
        return Promise.resolve();
      }
      public resume(): Promise<void> {
        return Promise.resolve();
      }
    }
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: SyntheticAudioContext,
    });

    class SyntheticAudioWorkletNode {
      public readonly port: {
        close: () => void;
        onmessage: ((event: MessageEvent<{ pcm: ArrayBuffer; type: string }>) => void) | null;
      };
      private readonly timers: ReturnType<typeof globalThis.setTimeout>[] = [];
      public constructor() {
        pendingPcmNodes.add(this);
        this.port = {
          close: (): void => {
            for (const timer of this.timers) globalThis.clearTimeout(timer);
          },
          onmessage: null,
        };
      }
      public connect(): this {
        return this;
      }
      public disconnect(): void {
        pendingPcmNodes.delete(this);
        this.port.close();
      }
      public emitFrames(): void {
        if (!pcmFramesReleased) return;
        for (const delay of [100, 180]) {
          this.timers.push(
            globalThis.setTimeout(() => {
              if (this.port.onmessage !== null) {
                this.port.onmessage({
                  data: { pcm: new Uint8Array(3_200).buffer, type: 'pcm-frame' },
                } as MessageEvent<{ pcm: ArrayBuffer; type: string }>);
              }
            }, delay),
          );
        }
      }
    }
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: SyntheticAudioWorkletNode,
    });

    class SyntheticMediaRecorder {
      public static isTypeSupported(): boolean {
        return true;
      }
      public readonly mimeType = 'audio/webm;codecs=opus';
      public ondataavailable: ((event: { data: Blob }) => void) | null = null;
      public onerror: ((event: Event) => void) | null = null;
      public onstop: ((event: Event) => void) | null = null;
      public state: RecordingState = 'inactive';
      private timer: ReturnType<typeof globalThis.setInterval> | null = null;
      public start(): void {
        this.state = 'recording';
        this.emit();
        this.timer = globalThis.setInterval(() => {
          this.emit();
        }, 30);
      }
      public stop(): void {
        if (this.state === 'inactive') return;
        if (this.timer !== null) globalThis.clearInterval(this.timer);
        this.timer = null;
        this.emit();
        this.state = 'inactive';
        if (this.onstop !== null) {
          this.onstop(new Event('stop'));
        }
      }
      private emit(): void {
        if (this.ondataavailable !== null) {
          this.ondataavailable({
            data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }),
          });
        }
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: SyntheticMediaRecorder,
    });
  });
}

async function readActiveWorkflowIdentity(page: Page): Promise<{
  projectId: string | null;
  sessionId: string | null;
  step: string;
  workflowId: string;
}> {
  return page.evaluate(async () => {
    const actorResponse = await fetch('/api/v1/auth/me', { cache: 'no-store' });
    if (!actorResponse.ok) throw new Error('authenticated actor lookup failed');
    const actor = (await actorResponse.json()) as { id?: unknown };
    if (typeof actor.id !== 'string') throw new Error('authenticated actor id is unavailable');
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('elder-interview-new-workflow');
      open.onerror = (): void => {
        reject(open.error ?? new Error('workflow database open failed'));
      };
      open.onsuccess = (): void => {
        const database = open.result;
        const transaction = database.transaction('workflows', 'readonly');
        const request = transaction.objectStore('workflows').index('by-actor').getAll(actor.id);
        request.onerror = (): void => {
          reject(request.error ?? new Error('workflow read failed'));
        };
        request.onsuccess = (): void => {
          const workflow = (
            request.result as Array<{
              projectAttempt?: { response?: { id?: string } | null } | null;
              sessionAttempt?: { response?: { id?: string } | null } | null;
              status?: string;
              step?: string;
              workflowId: string;
            }>
          ).find((value) => value.status === 'active');
          database.close();
          if (workflow === undefined) {
            reject(new Error('active workflow not found'));
            return;
          }
          resolve({
            projectId: workflow.projectAttempt?.response?.id ?? null,
            sessionId: workflow.sessionAttempt?.response?.id ?? null,
            step: workflow.step ?? 'unknown',
            workflowId: workflow.workflowId,
          });
        };
      };
    });
  });
}

function emptySuggestion(sessionId: string | undefined): Record<string, unknown> {
  return {
    display_sequence: null,
    displayed_at: null,
    history: { has_previous: false },
    kind: 'continue_listening',
    presentation_revision: 0,
    question: null,
    reason: null,
    session_id: sessionId,
    snapshot_id: null,
    withdrawal_reason: null,
  };
}

async function expectNoDeadPage(page: Page): Promise<void> {
  await expect(page.getByText('这个页面不存在或已不可访问', { exact: true })).toHaveCount(0);
}
