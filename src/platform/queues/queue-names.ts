/**
 * Phase 4 §9 — exactly 25 batch queues. Interactive-lane work (CHAT, AUTOCOMPLETE,
 * chat-time RERANK) is intentionally absent (GAP-INTERACTIVE-STREAM-01).
 */
export const QUEUE_NAMES = [
  'extract',
  'ocr',
  'chunk',
  'embed',
  'embed-backfill',
  'orphan-sweep',
  'research-run-tick',
  'research-run-step',
  'extraction-cell',
  'screening',
  'stance',
  'synthesis',
  'derivation',
  'research-artifact-generate',
  'reaper',
  'discovery-search',
  'identity-resolve',
  'identity-merge',
  'connector-fetch',
  'external-record-refresh',
  'refmgr-import',
  'billing-sync',
  'billing-reconcile',
  'usage-rollup',
  'outbox-relay',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export function isQueueName(value: string): value is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(value);
}

/** BullMQ queue names must not contain ':' — use a hyphenated DLQ suffix. */
export function dlqNameFor(queueName: QueueName): string {
  return `${queueName}-dlq`;
}

/** Queues defined in inventory but without live R1 BullMQ processors. */
export const R1_FORWARD_COMPAT_QUEUES = ['screening', 'derivation'] as const satisfies readonly QueueName[];

export type R1ForwardCompatQueue = (typeof R1_FORWARD_COMPAT_QUEUES)[number];

export function hasR1Processor(queueName: QueueName): boolean {
  return !(R1_FORWARD_COMPAT_QUEUES as readonly string[]).includes(queueName);
}
