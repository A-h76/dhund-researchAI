import { Module } from '@nestjs/common';
import { L0Module } from '../l0/l0.module';
import { BillingReconcileCoordination } from './billing-reconcile.coordination';
import { BillingReconcileScheduler } from './billing-reconcile.scheduler';
import { BillingReconcileService } from './billing-reconcile.service';
import { BillingSyncService } from './billing-sync.service';
import { BillingMetrics } from './billing.metrics';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { UsageRollupService } from './usage-rollup.service';

@Module({
  imports: [L0Module],
  controllers: [StripeWebhookController],
  providers: [
    BillingMetrics,
    StripeWebhookService,
    BillingSyncService,
    UsageRollupService,
    BillingReconcileCoordination,
    BillingReconcileService,
    BillingReconcileScheduler,
  ],
  exports: [
    BillingMetrics,
    BillingSyncService,
    UsageRollupService,
    BillingReconcileService,
    BillingReconcileScheduler,
  ],
})
export class BillingModule {}
