import { Injectable } from '@nestjs/common';

@Injectable()
export class CitationMetrics {
  private projectionCount = 0;
  private projectionLatencyMsTotal = 0;
  private brokenChainCount = 0;

  recordProjection(input: { latencyMs: number; broken: boolean }): void {
    this.projectionCount += 1;
    this.projectionLatencyMsTotal += input.latencyMs;
    if (input.broken) {
      this.brokenChainCount += 1;
    }
  }

  snapshot(): {
    projectionCount: number;
    projectionLatencyMs: number;
    brokenChainCount: number;
  } {
    return {
      projectionCount: this.projectionCount,
      projectionLatencyMs:
        this.projectionCount === 0
          ? 0
          : this.projectionLatencyMsTotal / this.projectionCount,
      brokenChainCount: this.brokenChainCount,
    };
  }

  reset(): void {
    this.projectionCount = 0;
    this.projectionLatencyMsTotal = 0;
    this.brokenChainCount = 0;
  }
}
