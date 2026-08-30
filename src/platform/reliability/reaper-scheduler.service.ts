import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobEnqueueService } from '../logging/job-enqueue.service';
import { runWithCorrelationIdAsync } from '../logging/correlation-context';
import { REAPER_TICK_INTERVAL_MS } from './queue-liveness.config';
import { ReaperService } from './reaper.service';

const SYSTEM_ORG_ID = 'system';

@Injectable()
export class ReaperSchedulerService implements OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight = false;

  constructor(
    private readonly enqueueService: JobEnqueueService,
    private readonly reaperService: ReaperService,
  ) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }

    void this.scheduleTick();
    this.timer = setInterval(() => {
      void this.scheduleTick();
    }, REAPER_TICK_INTERVAL_MS);
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
      const tickBucket = floorToInterval(nowMs, REAPER_TICK_INTERVAL_MS).toISOString();
      const payload = {
        orgId: SYSTEM_ORG_ID,
        olderThan: tickBucket,
      };

      await runWithCorrelationIdAsync(`reaper-${tickBucket}`, async () => {
        await this.enqueueService.enqueue('reaper', payload);
      });

      const holderId = `reaper-${tickBucket}`;
      await this.reaperService.executeTick(tickBucket, holderId);
    } finally {
      this.tickInFlight = false;
    }
  }
}

export function floorToInterval(timestampMs: number, intervalMs: number): Date {
  return new Date(Math.floor(timestampMs / intervalMs) * intervalMs);
}
