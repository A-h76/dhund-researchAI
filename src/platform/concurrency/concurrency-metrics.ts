export interface ConcurrencyMetricsSnapshot {
  readonly gateWaitMs: number;
  readonly gateTimeoutCount: number;
  readonly orgInflightBatch: number;
  readonly globalInflightBatch: number;
  readonly interactiveLatencyMs: number;
}

export class ConcurrencyMetrics {
  private gateWaitMs = 0;
  private gateTimeoutCount = 0;
  private orgInflightBatch = 0;
  private globalInflightBatch = 0;
  private interactiveLatencyMs = 0;

  recordGateWait(waitMs: number): void {
    this.gateWaitMs += waitMs;
  }

  recordGateTimeout(count = 1): void {
    this.gateTimeoutCount += count;
  }

  recordOrgInflight(count: number): void {
    this.orgInflightBatch = count;
  }

  recordGlobalInflight(count: number): void {
    this.globalInflightBatch = count;
  }

  recordInteractiveLatency(latencyMs: number): void {
    this.interactiveLatencyMs = latencyMs;
  }

  snapshot(): ConcurrencyMetricsSnapshot {
    return {
      gateWaitMs: this.gateWaitMs,
      gateTimeoutCount: this.gateTimeoutCount,
      orgInflightBatch: this.orgInflightBatch,
      globalInflightBatch: this.globalInflightBatch,
      interactiveLatencyMs: this.interactiveLatencyMs,
    };
  }

  reset(): void {
    this.gateWaitMs = 0;
    this.gateTimeoutCount = 0;
    this.orgInflightBatch = 0;
    this.globalInflightBatch = 0;
    this.interactiveLatencyMs = 0;
  }
}
