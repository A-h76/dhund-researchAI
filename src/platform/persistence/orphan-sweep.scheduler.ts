import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { LEASE_SERVICE, type LeaseService } from '../../l0/ports';
import { JobEnqueueService } from '../logging/job-enqueue.service';
import { runWithCorrelationIdAsync } from '../logging/correlation-context';
import { PlatformLogger } from '../logging/platform-logger.service';
import { PLATFORM_RELIABILITY_SCOPE } from '../reliability/queue-liveness.config';
import {
  ORPHAN_SWEEP_INTERVAL_MS,
  ORPHAN_SWEEP_SYSTEM_ORG_ID,
  orphanSweepOlderThan,
} from './orphan-sweep.constants';
import { OrphanSweepService } from './orphan-sweep.service';

const LEASE_TTL_SECONDS = 120;

@Injectable()
export class OrphanSweepSchedulerService implements OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight = false;

  constructor(
    private readonly enqueueService: JobEnqueueService,
    private readonly sweep: OrphanSweepService,
    @Inject(LEASE_SERVICE) private readonly leases: LeaseService,
    private readonly logger: PlatformLogger,
  ) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    void this.scheduleTick();
    this.timer = setInterval(() => {
      void this.scheduleTick();
    }, ORPHAN_SWEEP_INTERVAL_MS);
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
      const olderThan = orphanSweepOlderThan(nowMs);
      const payload = {
        orgId: ORPHAN_SWEEP_SYSTEM_ORG_ID,
        olderThan,
      };
      await runWithCorrelationIdAsync(`orphan-sweep-${olderThan}`, async () => {
        await this.enqueueService.enqueue('orphan-sweep', payload);
      });
      const claim = await this.leases.tryAcquire(
        PLATFORM_RELIABILITY_SCOPE,
        `orphan-sweep:tick:${olderThan}`,
        `orphan-sweep-${olderThan}`,
        LEASE_TTL_SECONDS,
      );
      if (claim === 'contended') {
        return;
      }
      await this.sweep.run(new Date(olderThan));
    } catch (error) {
      this.logger.warn({
        module: 'ingestion',
        message: 'orphan.sweep.tick_failed',
        reason: error instanceof Error ? error.message : 'unknown',
      });
    } finally {
      this.tickInFlight = false;
    }
  }
}
