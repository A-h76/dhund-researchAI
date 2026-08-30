import type { QueueName } from '../queues/queue-names';

/** Gate acquire timeout before demotion to a delayed job. */
export const GATE_ACQUIRE_TIMEOUT_MS = 30_000;

/** Delay applied when gate acquire times out (demotion, not failure). */
export const GATE_DEMOTION_DELAY_MS = 60_000;

/** Default upload concurrency per org (Phase 4 §6). */
export const UPLOAD_CONCURRENCY_DEFAULT = 5;

/** Default per-org batch concurrency. */
export const PER_ORG_BATCH_CONCURRENCY_DEFAULT = 10;

/** Total batch lane capacity across all orgs. */
export const GLOBAL_BATCH_CONCURRENCY = 50;

/** Reserved capacity so batch saturation cannot collapse the interactive lane. */
export const INTERACTIVE_RESERVE_SLOTS = 10;

/** GAP-ADMIN-JOB-01 — embed-backfill uses a global cap, not per-org. */
export const EMBED_BACKFILL_GLOBAL_CAP = 2;

/** Counter TTL — non-authoritative; Redis flush resets gates safely. */
export const GATE_COUNTER_TTL_SECONDS = 300;

/** Interactive latency budget in ms for fairness assertions. */
export const INTERACTIVE_LATENCY_BUDGET_MS = 100;

/** Queues subject to upload concurrency limits. */
export const UPLOAD_GATED_QUEUES = ['extract', 'ocr', 'chunk'] as const satisfies readonly QueueName[];

export type UploadGatedQueue = (typeof UPLOAD_GATED_QUEUES)[number];

export function isUploadGatedQueue(queueName: QueueName): queueName is UploadGatedQueue {
  return (UPLOAD_GATED_QUEUES as readonly string[]).includes(queueName);
}

export function effectiveGlobalBatchLimit(): number {
  return GLOBAL_BATCH_CONCURRENCY - INTERACTIVE_RESERVE_SLOTS;
}

export function buildOrgBatchCounterKey(orgId: string): string {
  return `gate:batch:org:${orgId}`;
}

export function buildGlobalBatchCounterKey(): string {
  return 'gate:batch:global';
}

export function buildOrgUploadCounterKey(orgId: string): string {
  return `gate:upload:org:${orgId}`;
}

export function buildEmbedBackfillGlobalCounterKey(): string {
  return 'gate:embed-backfill:global';
}
