import { Inject, Injectable } from '@nestjs/common';
import {
  BILLING_STORE,
  QUEUE_SERVICE,
  USAGE_METRICS,
  type BillingStore,
  type QueueService,
  type UsageMetricName,
} from '../l0/ports';
import { generateId } from '../platform/ids/uuid-v7';
import { runWithCorrelationIdAsync } from '../platform/logging/correlation-context';
import { deriveJobId, getQueuePolicy, resolveAttempts } from '../platform/queues';
import { BillingMetrics } from './billing.metrics';
import { usagePeriodFromStripe, type UsagePeriod } from './usage-period';

export interface UsageRollupInput {
  readonly orgId: string;
  readonly metric: UsageMetricName;
  readonly value: bigint;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
}

@Injectable()
export class UsageRollupService {
  constructor(
    @Inject(BILLING_STORE) private readonly store: BillingStore,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly metrics: BillingMetrics,
  ) {}

  async submit(input: UsageRollupInput): Promise<void> {
    await this.apply(input);
    const period = usagePeriodFromStripe(input.periodStart, input.periodEnd);
    const payload = {
      orgId: input.orgId,
      correlationId: `${input.orgId}:${period.period}`,
      period: period.period,
      metric: input.metric,
      value: input.value.toString(),
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
    };
    const policy = getQueuePolicy('usage-rollup');
    const attempts = resolveAttempts(policy);
    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.queue.addJob('usage-rollup', payload, {
        jobId: deriveJobId('usage-rollup', payload),
        ...(attempts !== undefined ? { attempts } : {}),
        ...(policy.backoff !== null ? { backoff: policy.backoff } : {}),
      });
    });
  }

  async apply(input: UsageRollupInput): Promise<void> {
    const period = usagePeriodFromStripe(input.periodStart, input.periodEnd);
    await this.write(input.orgId, input.metric, input.value, period);
  }

  async handle(payload: Record<string, unknown>): Promise<void> {
    const orgId = payload.orgId;
    const periodKey = payload.period;
    const metric = payload.metric;
    if (typeof orgId !== 'string' || typeof periodKey !== 'string' || !isUsageMetric(metric)) {
      return;
    }
    const value = parseValue(payload.value);
    if (value === null) {
      return;
    }
    const period = usagePeriodFromStripe(readDate(payload.periodStart), readDate(payload.periodEnd));
    const resolved = period.period === periodKey ? period : { ...period, period: periodKey };
    await this.write(orgId, metric, value, resolved);
  }

  private async write(
    orgId: string,
    metric: UsageMetricName,
    value: bigint,
    period: UsagePeriod,
  ): Promise<void> {
    const existing = await this.store.findUsage(orgId, period.period, metric);
    if (value === 0n && existing !== null && existing.value > 0n) {
      this.metrics.recordUsage(orgId, period.period, metric, existing.value);
      return;
    }
    if (value === 0n && existing === null && period.source === 'fallback') {
      return;
    }
    const row = await this.store.rollupUsage({
      id: generateId(),
      orgId,
      period: period.period,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      metric,
      value,
    });
    this.metrics.recordUsage(orgId, row.period, row.metric, row.value);
  }
}

function isUsageMetric(value: unknown): value is UsageMetricName {
  return typeof value === 'string' && (USAGE_METRICS as readonly string[]).includes(value);
}

function parseValue(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
