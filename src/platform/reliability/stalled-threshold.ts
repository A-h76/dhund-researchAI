import {
  STALLED_THRESHOLD_MINIMUM_MS,
  type QueueLivenessPolicy,
} from './queue-liveness.config';

export interface StalledThresholdInput {
  readonly stepType?: string;
  readonly recentDurationsMs: readonly number[];
  readonly minimumMs?: number;
  readonly medianMultiplier?: number;
}

/** GAP-HEARTBEAT-01 — per stepType rolling median with configured minimum floor. */
export function computeStalledThresholdMs(input: StalledThresholdInput): number {
  const minimum = input.minimumMs ?? STALLED_THRESHOLD_MINIMUM_MS;
  const multiplier = input.medianMultiplier ?? 2;

  if (input.recentDurationsMs.length === 0) {
    return minimum;
  }

  const sorted = [...input.recentDurationsMs].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? minimum) + (sorted[middle] ?? minimum)) / 2
      : (sorted[middle] ?? minimum);

  return Math.max(minimum, Math.round(median * multiplier));
}

export function isHeartbeatStale(
  lastHeartbeatAtMs: number,
  nowMs: number,
  policy: QueueLivenessPolicy,
  stalledThresholdMs: number,
): boolean {
  const sinceHeartbeat = nowMs - lastHeartbeatAtMs;
  return sinceHeartbeat > Math.max(policy.heartbeatIntervalMs, stalledThresholdMs);
}

export function hasExceededQueueTimeout(
  startedAtMs: number,
  nowMs: number,
  policy: QueueLivenessPolicy,
): boolean {
  return nowMs - startedAtMs > policy.timeoutMs;
}
