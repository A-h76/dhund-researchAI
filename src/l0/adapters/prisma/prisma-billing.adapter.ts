import { Injectable } from '@nestjs/common';
import { Prisma, type UsageMetric } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  BillingStore,
  StripeEventRecord,
  SubscriptionMirror,
  UsageCounterRecord,
  UsageMetricName,
} from '../../ports/billing.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

const MISSING_STRIPE_PERIOD_KEY = 'unscoped';

@Injectable()
export class PrismaBillingAdapter implements BillingStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async insertStripeEvent(input: {
    id: string;
    type: string;
    payload: unknown;
  }): Promise<'inserted' | 'duplicate'> {
    await this.database.connect();
    try {
      await this.client().stripeEvent.create({
        data: {
          id: input.id,
          type: input.type,
          payload: input.payload as Prisma.InputJsonValue,
          status: 'received',
        },
      });
      return 'inserted';
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return 'duplicate';
      }
      throw new L0OperationError('Stripe event persist failed', error);
    }
  }

  async findStripeEvent(id: string): Promise<StripeEventRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().stripeEvent.findUnique({ where: { id } });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        type: row.type,
        payload: row.payload,
        status: row.status,
      };
    } catch (error) {
      throw new L0OperationError('Stripe event lookup failed', error);
    }
  }

  async markStripeEvent(
    id: string,
    status: 'processed' | 'processing_failed',
  ): Promise<void> {
    await this.database.connect();
    try {
      await this.client().stripeEvent.update({
        where: { id },
        data: {
          status,
          ...(status === 'processed' ? { processedAt: new Date() } : {}),
        },
      });
    } catch (error) {
      throw new L0OperationError('Stripe event update failed', error);
    }
  }

  async upsertSubscription(input: SubscriptionMirror): Promise<void> {
    await this.database.connect();
    try {
      await this.client().subscription.upsert({
        where: { stripeSubscriptionId: input.stripeSubscriptionId },
        create: {
          id: input.id,
          orgId: input.orgId,
          stripeSubscriptionId: input.stripeSubscriptionId,
          planCode: input.planCode,
          status: input.status,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
        update: {
          planCode: input.planCode,
          status: input.status,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      });
    } catch (error) {
      throw new L0OperationError('Subscription mirror failed', error);
    }
  }

  async findSubscriptionByOrg(orgId: string): Promise<SubscriptionMirror | null> {
    await this.database.connect();
    try {
      const row = await this.client().subscription.findFirst({
        where: { orgId },
        orderBy: { updatedAt: 'desc' },
      });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        orgId: row.orgId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        planCode: row.planCode,
        status: row.status,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
      };
    } catch (error) {
      throw new L0OperationError('Subscription lookup failed', error);
    }
  }

  async rollupUsage(input: UsageCounterRecord & { id: string }): Promise<UsageCounterRecord> {
    await this.database.connect();
    try {
      const existing = await this.findCounter(input.orgId, input.period, input.metric);
      if (existing !== null) {
        const next = nextUsageValue(existing.value, input.value);
        if (next === existing.value) {
          return toUsage(existing);
        }
        const updated = await this.client().usageCounter.update({
          where: { id: existing.id },
          data: {
            value: next,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          },
        });
        return toUsage(updated);
      }
      const created = await this.client().usageCounter.create({
        data: {
          id: input.id,
          orgId: input.orgId,
          period: input.period,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          metric: input.metric,
          value: input.value,
        },
      });
      return toUsage(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const existing = await this.findCounter(input.orgId, input.period, input.metric);
        if (existing !== null) {
          return toUsage(existing);
        }
      }
      throw new L0OperationError('Usage rollup failed', error);
    }
  }

  async findUsage(
    orgId: string,
    period: string,
    metric: UsageMetricName,
  ): Promise<UsageCounterRecord | null> {
    await this.database.connect();
    try {
      const row = await this.findCounter(orgId, period, metric);
      return row === null ? null : toUsage(row);
    } catch (error) {
      throw new L0OperationError('Usage lookup failed', error);
    }
  }

  async listUsage(orgId: string): Promise<readonly UsageCounterRecord[]> {
    await this.database.connect();
    try {
      const rows = await this.client().usageCounter.findMany({ where: { orgId } });
      return rows.map(toUsage);
    } catch (error) {
      throw new L0OperationError('Usage list failed', error);
    }
  }

  async countReconciliationDrift(): Promise<number> {
    await this.database.connect();
    try {
      const subscriptions = await this.client().subscription.findMany();
      let drift = 0;
      for (const subscription of subscriptions) {
        const period = `${subscription.periodStart.toISOString()}/${subscription.periodEnd.toISOString()}`;
        const counters = await this.client().usageCounter.findMany({
          where: { orgId: subscription.orgId },
        });
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
    } catch (error) {
      throw new L0OperationError('Billing reconcile failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }

  private findCounter(orgId: string, period: string, metric: UsageMetricName) {
    return this.client().usageCounter.findUnique({
      where: { orgId_period_metric: { orgId, period, metric } },
    });
  }
}

function nextUsageValue(current: bigint, incoming: bigint): bigint {
  if (incoming === 0n && current > 0n) {
    return current;
  }
  return incoming;
}

function toUsage(row: {
  orgId: string;
  period: string;
  periodStart: Date;
  periodEnd: Date;
  metric: UsageMetric;
  value: bigint;
}): UsageCounterRecord {
  return {
    orgId: row.orgId,
    period: row.period,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    metric: row.metric,
    value: row.value,
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === undefined || current === null) {
      return false;
    }
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (code === 'P2002' || code === '23505') {
        return true;
      }
    }
    const message = current instanceof Error ? current.message : String(current);
    if (/23505|unique constraint failed|duplicate key/i.test(message)) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
