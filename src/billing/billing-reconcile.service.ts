import { Inject, Injectable } from '@nestjs/common';
import { BILLING_STORE, type BillingStore } from '../l0/ports';
import { BillingMetrics } from './billing.metrics';
import {
  BillingReconcileCoordination,
  type ReconcileClaim,
} from './billing-reconcile.coordination';

@Injectable()
export class BillingReconcileService {
  constructor(
    private readonly coordination: BillingReconcileCoordination,
    @Inject(BILLING_STORE) private readonly store: BillingStore,
    private readonly metrics: BillingMetrics,
  ) {}

  async executeTick(dateBucket: string, holderId: string): Promise<ReconcileClaim> {
    const claim = await this.coordination.tryClaimTick(dateBucket, holderId);
    if (claim === 'noop') {
      return 'noop';
    }
    const drift = await this.store.countReconciliationDrift();
    this.metrics.recordDrift(drift);
    return 'claimed';
  }
}
