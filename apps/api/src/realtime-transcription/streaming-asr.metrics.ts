import { Injectable } from '@nestjs/common';

export interface StreamingAsrMetricSnapshot {
  counters: Readonly<Record<string, number>>;
  gauges: Readonly<Record<string, number>>;
}

@Injectable()
export class StreamingAsrMetrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  public increment(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  public gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  public snapshot(): StreamingAsrMetricSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}
