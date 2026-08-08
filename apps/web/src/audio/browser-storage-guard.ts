import { AudioBufferCapacityError } from './errors.js';

export interface BrowserStorageGuardOptions {
  criticalAvailableBytes?: number;
  estimate?: () => Promise<StorageEstimate>;
  recommendedAvailableBytes?: number;
  runCanary: () => Promise<void>;
}

export interface BrowserStorageAssessment {
  availableBytes: number | null;
  recommendedCapacityAvailable: boolean | null;
}

const DEFAULT_CRITICAL_AVAILABLE_BYTES = 16 * 1024 * 1024;
const DEFAULT_RECOMMENDED_AVAILABLE_BYTES = 64 * 1024 * 1024;

export class BrowserStorageGuard {
  private readonly criticalAvailableBytes: number;
  private readonly estimate: (() => Promise<StorageEstimate>) | null;
  private readonly recommendedAvailableBytes: number;

  public constructor(private readonly options: BrowserStorageGuardOptions) {
    this.criticalAvailableBytes =
      options.criticalAvailableBytes ?? DEFAULT_CRITICAL_AVAILABLE_BYTES;
    this.recommendedAvailableBytes =
      options.recommendedAvailableBytes ?? DEFAULT_RECOMMENDED_AVAILABLE_BYTES;
    if (
      !Number.isSafeInteger(this.criticalAvailableBytes) ||
      this.criticalAvailableBytes < 0 ||
      !Number.isSafeInteger(this.recommendedAvailableBytes) ||
      this.recommendedAvailableBytes < this.criticalAvailableBytes
    ) {
      throw new RangeError('storage thresholds are invalid');
    }
    const storage = Reflect.get(globalThis.navigator, 'storage') as unknown;
    this.estimate = options.estimate ?? storageEstimate(storage);
  }

  public async assertCanStart(): Promise<BrowserStorageAssessment> {
    await this.options.runCanary();
    return this.assess();
  }

  public async assertCanContinue(): Promise<BrowserStorageAssessment> {
    return this.assess();
  }

  private async assess(): Promise<BrowserStorageAssessment> {
    if (this.estimate === null) {
      return { availableBytes: null, recommendedCapacityAvailable: null };
    }
    const { quota, usage } = await this.estimate();
    if (!Number.isFinite(quota) || !Number.isFinite(usage)) {
      return { availableBytes: null, recommendedCapacityAvailable: null };
    }
    const availableBytes = Math.max(0, (quota ?? 0) - (usage ?? 0));
    if (availableBytes <= this.criticalAvailableBytes) throw new AudioBufferCapacityError();
    return {
      availableBytes,
      recommendedCapacityAvailable: availableBytes >= this.recommendedAvailableBytes,
    };
  }
}

function storageEstimate(value: unknown): (() => Promise<StorageEstimate>) | null {
  if (typeof value !== 'object' || value === null) return null;
  const estimate = Reflect.get(value, 'estimate') as unknown;
  if (typeof estimate !== 'function') return null;
  return (): Promise<StorageEstimate> => (estimate as () => Promise<StorageEstimate>).call(value);
}
