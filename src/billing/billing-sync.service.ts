import { Inject, Injectable } from '@nestjs/common';
import { BILLING_STORE, type BillingStore } from '../l0/ports';
import { generateId } from '../platform/ids/uuid-v7';
import { BillingMetrics } from './billing.metrics';
import { deriveEntitlement } from './entitlement';
import {
  isSubscriptionEvent,
  readSubscriptionSnapshot,
} from './stripe-event';
import { usagePeriodFromStripe } from './usage-period';

@Injectable()
export class BillingSyncService {
  constructor(
    @Inject(BILLING_STORE) private readonly store: BillingStore,
    private readonly metrics: BillingMetrics,
  ) {}

  async handle(stripeEventId: string): Promise<void> {
    const event = await this.store.findStripeEvent(stripeEventId);
    if (event === null || event.status === 'processed') {
      return;
    }
    if (!isRecord(event.payload) || !isSubscriptionEvent(event.type)) {
      await this.store.markStripeEvent(stripeEventId, 'processed');
      return;
    }

    const snapshot = readSubscriptionSnapshot(event.payload);
    if (snapshot === null) {
      await this.store.markStripeEvent(stripeEventId, 'processing_failed');
      return;
    }

    const period = usagePeriodFromStripe(snapshot.periodStart, snapshot.periodEnd);
    const entitlement = deriveEntitlement(snapshot.planCode);
    this.metrics.recordEntitlement(entitlement.kind);
    await this.store.upsertSubscription({
      id: generateId(),
      orgId: snapshot.orgId,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      planCode: snapshot.planCode,
      status: snapshot.status,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    });
    await this.store.markStripeEvent(stripeEventId, 'processed');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
