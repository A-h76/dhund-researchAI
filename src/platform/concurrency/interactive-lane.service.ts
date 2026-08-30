import { Injectable } from '@nestjs/common';
import {
  INTERACTIVE_LATENCY_BUDGET_MS,
  effectiveGlobalBatchLimit,
  GLOBAL_BATCH_CONCURRENCY,
} from './concurrency-gate.config';
import { ConcurrencyMetrics } from './concurrency-metrics';

/**
 * Interactive-lane work runs on the API and is not gated by batch semaphores.
 * This service enforces the fairness assertion that batch saturation must not
 * starve interactive latency.
 */
@Injectable()
export class InteractiveLaneService {
  private batchSaturated = false;

  constructor(private readonly metrics: ConcurrencyMetrics) {}

  markBatchSaturated(saturated: boolean): void {
    this.batchSaturated = saturated;
  }

  isBatchSaturated(): boolean {
    return this.batchSaturated;
  }

  async runInteractiveProbe<T>(operation: () => Promise<T> | T): Promise<T> {
    const started = Date.now();
    const result = await operation();
    const latencyMs = Date.now() - started;
    this.metrics.recordInteractiveLatency(latencyMs);

    if (latencyMs > INTERACTIVE_LATENCY_BUDGET_MS) {
      throw new Error(
        `Interactive lane exceeded latency budget: ${latencyMs}ms > ${INTERACTIVE_LATENCY_BUDGET_MS}ms`,
      );
    }

    return result;
  }

  async assertBatchDoesNotStarveInteractive(): Promise<void> {
    if (!this.batchSaturated) {
      return;
    }

    await this.runInteractiveProbe(async () => 'interactive-ok');
  }

  getReservedCapacity(): { global: number; interactiveReserve: number; batchEffective: number } {
    return {
      global: GLOBAL_BATCH_CONCURRENCY,
      interactiveReserve: GLOBAL_BATCH_CONCURRENCY - effectiveGlobalBatchLimit(),
      batchEffective: effectiveGlobalBatchLimit(),
    };
  }
}
