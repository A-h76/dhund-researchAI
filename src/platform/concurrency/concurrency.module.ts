import { Module } from '@nestjs/common';
import { L0Module } from '../../l0/l0.module';
import { BatchConcurrencyGateService } from './batch-concurrency-gate.service';
import { ConcurrencyMetrics } from './concurrency-metrics';
import { EnqueueAdmissionService } from './enqueue-admission.service';
import { GateSlotRegistry } from './gate-slot.registry';
import { InteractiveLaneService } from './interactive-lane.service';

@Module({
  imports: [L0Module],
  providers: [
    ConcurrencyMetrics,
    BatchConcurrencyGateService,
    InteractiveLaneService,
    EnqueueAdmissionService,
    GateSlotRegistry,
  ],
  exports: [
    ConcurrencyMetrics,
    BatchConcurrencyGateService,
    InteractiveLaneService,
    EnqueueAdmissionService,
    GateSlotRegistry,
  ],
})
export class ConcurrencyModule {}
