import { Injectable } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';
import type { QueueName } from '../queues/queue-names';
import {
  BatchConcurrencyGateService,
  type AcquiredGateSlot,
} from './batch-concurrency-gate.service';
import {
  GATE_ACQUIRE_TIMEOUT_MS,
  GATE_DEMOTION_DELAY_MS,
} from './concurrency-gate.config';
import { ConcurrencyMetrics } from './concurrency-metrics';
import { InteractiveLaneService } from './interactive-lane.service';

export type AdmissionOutcome =
  | {
      readonly kind: 'admitted';
      readonly slot: AcquiredGateSlot;
      readonly delayMs?: undefined;
      readonly waitedMs: number;
    }
  | {
      readonly kind: 'demoted';
      readonly slot?: undefined;
      readonly delayMs: number;
      readonly waitedMs: number;
    };

export class AdmissionRejectedError extends DomainError {
  constructor(orgId: string) {
    super(ErrorCode.ConcurrencyLimit, {
      module: 'concurrency',
      details: { orgId, reason: 'per_org_batch_limit' },
      userMessage:
        'Your organization has reached its concurrent batch job limit. Try again shortly.',
    });
    this.name = 'AdmissionRejectedError';
  }
}

@Injectable()
export class EnqueueAdmissionService {
  constructor(
    private readonly gate: BatchConcurrencyGateService,
    private readonly interactiveLane: InteractiveLaneService,
    private readonly metrics: ConcurrencyMetrics,
  ) {}

  async admitBeforeEnqueue(input: {
    orgId: string;
    queueName: QueueName;
    orgLimit?: number;
  }): Promise<AdmissionOutcome> {
    await this.interactiveLane.assertBatchDoesNotStarveInteractive();

    const orgInflight = await this.gate.getOrgInflight(input.orgId);
    if (this.gate.isOrgOverHardLimit(orgInflight, input.orgLimit)) {
      throw new AdmissionRejectedError(input.orgId);
    }

    const started = Date.now();
    const deadline = started + GATE_ACQUIRE_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const slot = await this.gate.tryAcquireImmediate(
        input.orgId,
        input.queueName,
        input.orgLimit,
      );
      if (slot !== null) {
        const waitedMs = Date.now() - started;
        this.metrics.recordGateWait(waitedMs);
        return { kind: 'admitted', slot, waitedMs };
      }

      await delay(Math.min(50, deadline - Date.now()));
    }

    const waitedMs = Date.now() - started;
    this.metrics.recordGateWait(waitedMs);
    this.metrics.recordGateTimeout();
    return { kind: 'demoted', delayMs: GATE_DEMOTION_DELAY_MS, waitedMs };
  }

  async releaseSlot(slot: AcquiredGateSlot): Promise<void> {
    await this.gate.release(slot);
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
