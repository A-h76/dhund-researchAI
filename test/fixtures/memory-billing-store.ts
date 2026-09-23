import type {
  BillingStore,
  StripeEventRecord,
  StripeEventStatusName,
  SubscriptionMirror,
  UsageCounterRecord,
  UsageMetricName,
} from '../../src/l0/ports/billing.port';

const MISSING_STRIPE_PERIOD_KEY = 'unscoped';

export class MemoryBillingStore implements BillingStore {
  readonly events = new Map<string, StripeEventRecord>();
  readonly subscriptions = new Map<string, SubscriptionMirror>();
  readonly usage = new Map<string, UsageCounterRecord>();

  async insertStripeEvent(input: {
    id: string;
    type: string;
    payload: unknown;
  }): Promise<'inserted' | 'duplicate'> {
    if (this.events.has(input.id)) {
      return 'duplicate';
    }
    this.events.set(input.id, {
      id: input.id,
      type: input.type,
      payload: input.payload,
      status: 'received',
    });
    return 'inserted';
  }

  async findStripeEvent(id: string): Promise<StripeEventRecord | null> {
    return this.events.get(id) ?? null;
  }

  async markStripeEvent(
    id: string,
    status: 'processed' | 'processing_failed',
  ): Promise<void> {
    const current = this.events.get(id);
    if (current === undefined) {
      return;
    }
    const next: StripeEventStatusName = status;
    this.events.set(id, { ...current, status: next });
  }

  async upsertSubscription(input: SubscriptionMirror): Promise<void> {
    this.subscriptions.set(input.stripeSubscriptionId, input);
  }

  async findSubscriptionByOrg(orgId: string): Promise<SubscriptionMirror | null> {
    for (const row of this.subscriptions.values()) {
      if (row.orgId === orgId) {
        return row;
      }
    }
    return null;
  }

  async rollupUsage(input: UsageCounterRecord & { id: string }): Promise<UsageCounterRecord> {
    const key = usageKey(input.orgId, input.period, input.metric);
    const existing = this.usage.get(key);
    if (existing !== undefined) {
      const value = input.value === 0n && existing.value > 0n ? existing.value : input.value;
      const next = { ...existing, value, periodStart: input.periodStart, periodEnd: input.periodEnd };
      this.usage.set(key, next);
      return next;
    }
    const created: UsageCounterRecord = {
      orgId: input.orgId,
      period: input.period,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      metric: input.metric,
      value: input.value,
    };
    this.usage.set(key, created);
    return created;
  }

  async findUsage(
    orgId: string,
    period: string,
    metric: UsageMetricName,
  ): Promise<UsageCounterRecord | null> {
    return this.usage.get(usageKey(orgId, period, metric)) ?? null;
  }

  async listUsage(orgId: string): Promise<readonly UsageCounterRecord[]> {
    return [...this.usage.values()].filter((row) => row.orgId === orgId);
  }

  async countReconciliationDrift(): Promise<number> {
    let drift = 0;
    for (const subscription of this.subscriptions.values()) {
      const period = `${subscription.periodStart.toISOString()}/${subscription.periodEnd.toISOString()}`;
      const counters = await this.listUsage(subscription.orgId);
      const onPeriod = counters.some((row) => row.period === period);
      const positiveElsewhere = counters.some(
        (row) =>
          row.value > 0n &&
          row.period !== period &&
          row.period !== MISSING_STRIPE_PERIOD_KEY,
      );
      if (positiveElsewhere && !onPeriod) {
        drift += 1;
      }
    }
    return drift;
  }
}

function usageKey(orgId: string, period: string, metric: string): string {
  return `${orgId}|${period}|${metric}`;
}
