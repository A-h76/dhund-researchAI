import type { QueueName } from '../queues/queue-names';
import { QUEUE_NAMES } from '../queues/queue-names';

/** GAP-TIMEOUT-01 — every queue has authoritative timeout + heartbeat values. */
export interface QueueLivenessPolicy {
  readonly timeoutMs: number;
  readonly heartbeatIntervalMs: number;
  readonly leaseTtlSeconds: number;
}

/** GAP-HEARTBEAT-01 — stalled threshold floor when rolling window is empty. */
export const STALLED_THRESHOLD_MINIMUM_MS = 30_000;

export const REAPER_TICK_INTERVAL_MS = 60_000;

export const PLATFORM_RELIABILITY_SCOPE = 'platform';

const SHORT = { timeoutMs: 120_000, heartbeatIntervalMs: 15_000, leaseTtlSeconds: 45 };
const MEDIUM = { timeoutMs: 600_000, heartbeatIntervalMs: 30_000, leaseTtlSeconds: 60 };
const LONG = { timeoutMs: 3_600_000, heartbeatIntervalMs: 60_000, leaseTtlSeconds: 120 };
const INFINITE = { timeoutMs: 86_400_000, heartbeatIntervalMs: 60_000, leaseTtlSeconds: 120 };

export const QUEUE_LIVENESS_REGISTRY: Readonly<Record<QueueName, QueueLivenessPolicy>> =
  Object.freeze({
    extract: MEDIUM,
    ocr: MEDIUM,
    chunk: LONG,
    embed: LONG,
    'embed-backfill': MEDIUM,
    'orphan-sweep': SHORT,
    'research-run-tick': INFINITE,
    'research-run-step': LONG,
    'extraction-cell': MEDIUM,
    screening: MEDIUM,
    stance: MEDIUM,
    synthesis: MEDIUM,
    derivation: MEDIUM,
    'research-artifact-generate': MEDIUM,
    reaper: SHORT,
    'discovery-search': MEDIUM,
    'identity-resolve': MEDIUM,
    'identity-merge': MEDIUM,
    'connector-fetch': LONG,
    'external-record-refresh': MEDIUM,
    'refmgr-import': MEDIUM,
    'billing-sync': MEDIUM,
    'billing-reconcile': SHORT,
    'usage-rollup': MEDIUM,
    'outbox-relay': INFINITE,
  });

export function getQueueLivenessPolicy(queueName: QueueName): QueueLivenessPolicy {
  return QUEUE_LIVENESS_REGISTRY[queueName];
}

export function listQueueLivenessPolicies(): readonly QueueLivenessPolicy[] {
  return QUEUE_NAMES.map((name) => QUEUE_LIVENESS_REGISTRY[name]);
}

export function assertAllQueuesHaveLivenessPolicy(): void {
  for (const name of QUEUE_NAMES) {
    if (QUEUE_LIVENESS_REGISTRY[name] === undefined) {
      throw new Error(`Missing liveness policy for queue "${name}"`);
    }
  }
}

assertAllQueuesHaveLivenessPolicy();
