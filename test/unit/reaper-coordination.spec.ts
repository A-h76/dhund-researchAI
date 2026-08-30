import { ReaperCoordinationService } from '../../src/platform/reliability';
import type { LeaseService } from '../../src/l0/ports';

describe('reaper coordination (DHB-41, GAP-COORD-LOCK-01)', () => {
  const holders = new Map<string, string>();

  const lease: LeaseService = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    tryAcquire: async (_scope, key, holderId) => {
      const current = holders.get(key);
      if (current === undefined) {
        holders.set(key, holderId);
        return 'acquired';
      }
      if (current === holderId) {
        return 'renewed';
      }
      return 'contended';
    },
    renew: async (_scope, key, holderId) => holders.get(key) === holderId,
    release: async (_scope, key, holderId) => {
      if (holders.get(key) !== holderId) {
        return false;
      }
      holders.delete(key);
      return true;
    },
    getHolder: async (_scope, key) => holders.get(key) ?? null,
  };

  it('allows exactly one recovery claim when two reapers race', async () => {
    holders.clear();
    const coordination = new ReaperCoordinationService(lease);

    const [first, second] = await Promise.all([
      coordination.tryClaimRecovery('extract', 'job-1', 'reaper-a'),
      coordination.tryClaimRecovery('extract', 'job-1', 'reaper-b'),
    ]);

    const claims = [first, second].filter((result) => result === 'claimed');
    expect(claims).toHaveLength(1);
  });

  it('does not require the advisory lock stub for correctness', async () => {
    holders.clear();
    const coordination = new ReaperCoordinationService(lease);
    const seen: string[] = [];

    await coordination.withAdvisoryLock('noop-lock', async () => {
      seen.push('ran');
      return 'ok';
    });

    expect(seen).toEqual(['ran']);
  });
});
