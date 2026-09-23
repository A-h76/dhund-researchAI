export const BILLING_STORE = Symbol('BILLING_STORE');

export const USAGE_METRICS = [
  'ai_tokens',
  'ai_cost_micros',
  'documents',
  'storage_bytes',
  'seats',
] as const;

export type UsageMetricName = (typeof USAGE_METRICS)[number];

export type StripeEventStatusName = 'received' | 'processed' | 'processing_failed';

export interface StripeEventRecord {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly status: StripeEventStatusName;
}

export interface SubscriptionMirror {
  readonly id: string;
  readonly orgId: string;
  readonly stripeSubscriptionId: string;
  readonly planCode: string;
  readonly status: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

export interface UsageCounterRecord {
  readonly orgId: string;
  readonly period: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly metric: UsageMetricName;
  readonly value: bigint;
}

export interface BillingStore {
  insertStripeEvent(input: {
    id: string;
    type: string;
    payload: unknown;
  }): Promise<'inserted' | 'duplicate'>;
  findStripeEvent(id: string): Promise<StripeEventRecord | null>;
  markStripeEvent(id: string, status: 'processed' | 'processing_failed'): Promise<void>;
  upsertSubscription(input: SubscriptionMirror): Promise<void>;
  findSubscriptionByOrg(orgId: string): Promise<SubscriptionMirror | null>;
  rollupUsage(input: UsageCounterRecord & { id: string }): Promise<UsageCounterRecord>;
  findUsage(
    orgId: string,
    period: string,
    metric: UsageMetricName,
  ): Promise<UsageCounterRecord | null>;
  listUsage(orgId: string): Promise<readonly UsageCounterRecord[]>;
  countReconciliationDrift(): Promise<number>;
}
