import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobEnqueueService } from '../platform/logging/job-enqueue.service';
import { runWithCorrelationIdAsync } from '../platform/logging/correlation-context';
import { BillingReconcileService } from './billing-reconcile.service';

/** Tick lock bucket only. Usage periods do not use this calendar key. */
export const BILLING_RECONCILE_INTERVAL_MS = 60_000;

const SYSTEM_ORG_ID = 'system';

@Injectable()
export class BillingReconcileScheduler implements OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight = false;

  constructor(
    private readonly enqueueService: JobEnqueueService,
    private readonly reconcile: BillingReconcileService,
  ) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    void this.scheduleTick();
    this.timer = setInterval(() => {
      void this.scheduleTick();
    }, BILLING_RECONCILE_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  async scheduleTick(nowMs: number = Date.now()): Promise<void> {
    if (this.tickInFlight) {
      return;
    }
    this.tickInFlight = true;
    try {
      const dateBucket = new Date(nowMs).toISOString().slice(0, 10);
      const holderId = `billing-reconcile-${process.pid}-${dateBucket}`;
      await runWithCorrelationIdAsync(`billing-reconcile-${dateBucket}`, async () => {
        await this.enqueueService.enqueue('billing-reconcile', {
          orgId: SYSTEM_ORG_ID,
          dateBucket,
        });
      });
      await this.reconcile.executeTick(dateBucket, holderId);
    } catch {
      // The next tick retries. A failed enqueue must not kill the worker.
    } finally {
      this.tickInFlight = false;
    }
  }
}
