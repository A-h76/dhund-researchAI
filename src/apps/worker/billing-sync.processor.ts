import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProcessorRegistry } from './processor-registry';
import { BillingQueueConsumer } from '../../billing/billing-queue.consumer';

@Injectable()
export class BillingSyncProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    private readonly consumer: BillingQueueConsumer,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('billing-sync');
    await this.consumer.start();
  }
}
