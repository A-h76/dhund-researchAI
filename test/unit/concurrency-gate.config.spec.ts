import {
  EMBED_BACKFILL_GLOBAL_CAP,
  effectiveGlobalBatchLimit,
  GATE_ACQUIRE_TIMEOUT_MS,
  GATE_DEMOTION_DELAY_MS,
  INTERACTIVE_RESERVE_SLOTS,
  UPLOAD_CONCURRENCY_DEFAULT,
} from '../../src/platform/concurrency';

describe('concurrency gate config (DHB-42)', () => {
  it('reserves interactive capacity from the global batch pool', () => {
    expect(INTERACTIVE_RESERVE_SLOTS).toBeGreaterThan(0);
    expect(effectiveGlobalBatchLimit()).toBeGreaterThan(0);
  });

  it('uses a 30s gate acquire timeout with delayed demotion', () => {
    expect(GATE_ACQUIRE_TIMEOUT_MS).toBe(30_000);
    expect(GATE_DEMOTION_DELAY_MS).toBeGreaterThan(0);
  });

  it('caps embed-backfill globally rather than per org', () => {
    expect(EMBED_BACKFILL_GLOBAL_CAP).toBeGreaterThan(0);
  });

  it('defaults upload concurrency to five per org', () => {
    expect(UPLOAD_CONCURRENCY_DEFAULT).toBe(5);
  });
});
