import { Injectable, OnModuleInit } from '@nestjs/common';
import { isQueueName, type QueueName } from './queue-names';
import { QueueMetricsService } from './queue-metrics';
import {
  registerQueueObservation,
  type QueueJobObservation,
} from '../../l0/observability-bridge';
import { MetricsSurface } from '../observability/metrics-surface';

@Injectable()
export class QueueObservationRegistrar implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsSurface,
    private readonly queues: QueueMetricsService,
  ) {}

  onModuleInit(): void {
    registerQueueObservation((event) => {
      this.onJob(event);
    });
  }

  onJob(event: QueueJobObservation): void {
    if (!isQueueName(event.queue)) {
      return;
    }
    const queue: QueueName = event.queue;
    this.metrics.recordQueueJob({
      queue,
      waitMs: event.waitMs,
      processMs: event.processMs,
      retry: event.retry,
    });
    void this.queues.snapshot(queue);
  }
}
