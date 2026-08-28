import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, QueueService } from '../../l0/ports';

@Injectable()
export class WorkerBootstrapService implements OnModuleInit {
  constructor(@Inject(QUEUE_SERVICE) private readonly queue: QueueService) {}

  async onModuleInit(): Promise<void> {
    await this.queue.ping();
  }
}
