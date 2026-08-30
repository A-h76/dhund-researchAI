import {
  STALLED_THRESHOLD_MINIMUM_MS,
  computeStalledThresholdMs,
  hasExceededQueueTimeout,
  isHeartbeatStale,
} from '../../src/platform/reliability';

describe('stalled threshold (DHB-41, GAP-HEARTBEAT-01)', () => {
  it('returns the configured minimum when the rolling window is empty', () => {
    expect(
      computeStalledThresholdMs({
        stepType: 'extract-cell',
        recentDurationsMs: [],
      }),
    ).toBe(STALLED_THRESHOLD_MINIMUM_MS);
  });

  it('never drops below the minimum when the rolling median is tiny', () => {
    expect(
      computeStalledThresholdMs({
        stepType: 'extract-cell',
        recentDurationsMs: [100, 200, 300],
        minimumMs: 30_000,
      }),
    ).toBe(30_000);
  });

  it('uses the rolling median multiplier when above the minimum', () => {
    expect(
      computeStalledThresholdMs({
        stepType: 'synthesis',
        recentDurationsMs: [20_000, 30_000, 40_000],
      }),
    ).toBe(60_000);
  });

  it('treats fresh heartbeats as not stale even past nominal timeout', () => {
    const now = 1_000_000;
    const policy = { timeoutMs: 60_000, heartbeatIntervalMs: 15_000, leaseTtlSeconds: 45 };
    expect(
      isHeartbeatStale(now - 10_000, now, policy, STALLED_THRESHOLD_MINIMUM_MS),
    ).toBe(false);
    expect(hasExceededQueueTimeout(now - 120_000, now, policy)).toBe(true);
  });
});
