import {
  QUEUE_LIVENESS_REGISTRY,
  STALLED_THRESHOLD_MINIMUM_MS,
  getQueueLivenessPolicy,
} from '../../src/platform/reliability';
import { QUEUE_NAMES } from '../../src/platform/queues';

describe('queue liveness config (DHB-41, GAP-TIMEOUT-01)', () => {
  it('defines timeout and heartbeat for all 25 queues', () => {
    expect(QUEUE_NAMES).toHaveLength(25);
    for (const queue of QUEUE_NAMES) {
      const policy = getQueueLivenessPolicy(queue);
      expect(policy.timeoutMs).toBeGreaterThan(0);
      expect(policy.heartbeatIntervalMs).toBeGreaterThan(0);
      expect(policy.leaseTtlSeconds).toBeGreaterThan(0);
      expect(QUEUE_LIVENESS_REGISTRY[queue]).toBe(policy);
    }
  });

  it('uses per-queue values rather than a single global default', () => {
    expect(getQueueLivenessPolicy('reaper').timeoutMs).not.toBe(
      getQueueLivenessPolicy('extract').timeoutMs,
    );
    expect(getQueueLivenessPolicy('extract').timeoutMs).toBe(600_000);
  });

  it('documents the stalled threshold minimum floor', () => {
    expect(STALLED_THRESHOLD_MINIMUM_MS).toBeGreaterThanOrEqual(30_000);
  });
});
