import { Injectable, OnModuleInit } from '@nestjs/common';
import { BillingReconcileScheduler } from '../../billing/billing-reconcile.scheduler';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class BillingReconcileProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    private readonly scheduler: BillingReconcileScheduler,
  ) {}

  onModuleInit(): void {
    this.processors.register('billing-reconcile');
    this.scheduler.start();
  }
}
