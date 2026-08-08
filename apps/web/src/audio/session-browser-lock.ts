interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true; mode: 'exclusive' },
    callback: (lock: Lock | null) => Promise<void>,
  ): Promise<void>;
}

export interface SessionBrowserLockOptions {
  locks?: LockManagerLike | null;
}

export class SessionBrowserLock {
  private acquired = false;
  private releaseHeldLock: (() => void) | null = null;
  private requestPromise: Promise<void> | null = null;

  public constructor(
    private readonly sessionId: string,
    private readonly options: SessionBrowserLockOptions = {},
  ) {
    if (sessionId.trim().length === 0) throw new TypeError('sessionId is required');
  }

  public async acquire(): Promise<boolean> {
    if (this.acquired) return true;
    if (this.requestPromise !== null) throw new Error('browser lock acquisition already pending');
    const browserLocks = Reflect.get(globalThis.navigator, 'locks') as unknown;
    const locks = this.options.locks ?? asLockManager(browserLocks);
    if (locks === null) throw new Error('BROWSER_LOCK_UNAVAILABLE');

    let settleAttempt: (acquired: boolean) => void = () => undefined;
    const attempt = new Promise<boolean>((resolve) => {
      settleAttempt = resolve;
    });
    this.requestPromise = locks
      .request(
        `elder-interview:capture:${this.sessionId}`,
        { ifAvailable: true, mode: 'exclusive' },
        async (lock): Promise<void> => {
          if (lock === null) {
            settleAttempt(false);
            return;
          }
          this.acquired = true;
          settleAttempt(true);
          await new Promise<void>((resolve) => {
            this.releaseHeldLock = resolve;
          });
          this.releaseHeldLock = null;
          this.acquired = false;
        },
      )
      .finally(() => {
        this.requestPromise = null;
      });
    return attempt;
  }

  public async release(): Promise<void> {
    this.releaseHeldLock?.();
    await this.requestPromise;
  }
}

function asLockManager(value: unknown): LockManagerLike | null {
  if (typeof value !== 'object' || value === null) return null;
  return typeof Reflect.get(value, 'request') === 'function' ? (value as LockManagerLike) : null;
}
