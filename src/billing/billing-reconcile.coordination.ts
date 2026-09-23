import { Inject, Injectable } from '@nestjs/common';
import { LEASE_SERVICE, type LeaseService } from '../l0/ports';

export const BILLING_LEASE_SCOPE = 'billing';
export const BILLING_RECONCILE_LEASE_TTL_SECONDS = 120;

export type ReconcileClaim = 'claimed' | 'noop';

@Injectable()
export class BillingReconcileCoordination {
  constructor(@Inject(LEASE_SERVICE) private readonly lease: LeaseService) {}

  async tryClaimTick(dateBucket: string, holderId: string): Promise<ReconcileClaim> {
    const result = await this.lease.tryAcquire(
      BILLING_LEASE_SCOPE,
      `billing-reconcile:tick:${dateBucket}`,
      holderId,
      BILLING_RECONCILE_LEASE_TTL_SECONDS,
    );
    return result === 'contended' ? 'noop' : 'claimed';
  }
}
