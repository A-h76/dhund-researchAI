import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobEnqueueService } from '../logging/job-enqueue.service';
import { runWithCorrelationIdAsync } from '../logging/correlation-context';
import { OUTBOX_RELAY_TICK_INTERVAL_MS } from './outbox-relay.config';
import { OutboxRelayService } from './outbox-relay.service';

const SYSTEM_ORG_ID = 'system';

@Injectable()
export class OutboxRelaySchedulerService implements OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight = false;

  constructor(
    private readonly enqueueService: JobEnqueueService,
    private readonly relayService: OutboxRelayService,
  ) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }

    void this.scheduleTick();
    this.timer = setInterval(() => {
      void this.scheduleTick();
    }, OUTBOX_RELAY_TICK_INTERVAL_MS);
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
      const tickBucket = floorToInterval(nowMs, OUTBOX_RELAY_TICK_INTERVAL_MS).toISOString();
      const payload = {
        orgId: SYSTEM_ORG_ID,
        tick: tickBucket,
        batchSize: 50,
      };

      await runWithCorrelationIdAsync(`outbox-relay-${tickBucket}`, async () => {
        await this.enqueueService.enqueue('outbox-relay', payload);
      });

      const holderId = `outbox-relay-${tickBucket}`;
      await this.relayService.executeTick(tickBucket, holderId);
    } finally {
      this.tickInFlight = false;
    }
  }
}

export function floorToInterval(timestampMs: number, intervalMs: number): Date {
  return new Date(Math.floor(timestampMs / intervalMs) * intervalMs);
}
