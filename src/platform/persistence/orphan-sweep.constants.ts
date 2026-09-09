export const ORPHAN_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const ORPHAN_SWEEP_SYSTEM_ORG_ID = 'system';
export const LARGE_RECLAIM_ORPHAN_COUNT = 1000;
export const OWNED_KEYS_TIMEOUT_MS = 15_000;

export function orphanSweepOlderThan(nowMs: number = Date.now()): string {
  return new Date(Math.floor(nowMs / ORPHAN_SWEEP_INTERVAL_MS) * ORPHAN_SWEEP_INTERVAL_MS).toISOString();
}
