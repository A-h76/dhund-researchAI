export interface ReliabilityMetricsSnapshot {
  readonly reaperReclaimCount: number;
  readonly stalledJobCount: number;
  readonly heartbeatRenewalCount: number;
  readonly leaseExpiryCount: number;
}

export class ReliabilityMetrics {
  private reaperReclaimCount = 0;
  private stalledJobCount = 0;
  private heartbeatRenewalCount = 0;
  private leaseExpiryCount = 0;

  recordReaperReclaim(count = 1): void {
    this.reaperReclaimCount += count;
  }

  recordStalledJob(count = 1): void {
    this.stalledJobCount += count;
  }

  recordHeartbeatRenewal(count = 1): void {
    this.heartbeatRenewalCount += count;
  }

  recordLeaseExpiry(count = 1): void {
    this.leaseExpiryCount += count;
  }

  snapshot(): ReliabilityMetricsSnapshot {
    return {
      reaperReclaimCount: this.reaperReclaimCount,
      stalledJobCount: this.stalledJobCount,
      heartbeatRenewalCount: this.heartbeatRenewalCount,
      leaseExpiryCount: this.leaseExpiryCount,
    };
  }

  reset(): void {
    this.reaperReclaimCount = 0;
    this.stalledJobCount = 0;
    this.heartbeatRenewalCount = 0;
    this.leaseExpiryCount = 0;
  }
}
