import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
import { PlatformLogger } from '../logging/platform-logger.service';
import { dlqNameFor, type QueueName } from './queue-names';

export interface QueueMetricsSnapshot {
  readonly queue: QueueName;
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
  readonly delayed: number;
  readonly dlqWaiting: number;
}

@Injectable()
export class QueueMetricsService {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
    private readonly logger: PlatformLogger,
  ) {}

  async snapshot(queueName: QueueName): Promise<QueueMetricsSnapshot> {
    const counts = await this.queueService.getQueueDepth(queueName);
    const dlqCounts = await this.queueService.getQueueDepth(dlqNameFor(queueName));

    const metrics: QueueMetricsSnapshot = {
      queue: queueName,
      waiting: counts.waiting,
      active: counts.active,
      failed: counts.failed,
      delayed: counts.delayed,
      dlqWaiting: dlqCounts.waiting,
    };

    this.logger.info({
      module: 'queues',
      message: 'queue.metrics',
      ...metrics,
      alertDlq: metrics.dlqWaiting > 0,
    });

    return metrics;
  }
}
