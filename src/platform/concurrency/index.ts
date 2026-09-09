export { BatchConcurrencyGateService } from './batch-concurrency-gate.service';
export type { AcquiredGateSlot, GateSlotKind } from './batch-concurrency-gate.service';
export {
  buildEmbedBackfillGlobalCounterKey,
  buildGlobalBatchCounterKey,
  buildOrgBatchCounterKey,
  buildOrgUploadCounterKey,
  effectiveGlobalBatchLimit,
  EMBED_BACKFILL_GLOBAL_CAP,
  OCR_POOL_CEILING,
  GATE_ACQUIRE_TIMEOUT_MS,
  GATE_DEMOTION_DELAY_MS,
  GATE_COUNTER_TTL_SECONDS,
  GLOBAL_BATCH_CONCURRENCY,
  INTERACTIVE_LATENCY_BUDGET_MS,
  INTERACTIVE_RESERVE_SLOTS,
  isUploadGatedQueue,
  PER_ORG_BATCH_CONCURRENCY_DEFAULT,
  UPLOAD_CONCURRENCY_DEFAULT,
  UPLOAD_GATED_QUEUES,
} from './concurrency-gate.config';
export { ConcurrencyMetrics } from './concurrency-metrics';
export type { ConcurrencyMetricsSnapshot } from './concurrency-metrics';
export { ConcurrencyModule } from './concurrency.module';
export {
  AdmissionRejectedError,
  EnqueueAdmissionService,
} from './enqueue-admission.service';
export type { AdmissionOutcome } from './enqueue-admission.service';
export { GateSlotRegistry } from './gate-slot.registry';
export { InteractiveLaneService } from './interactive-lane.service';
