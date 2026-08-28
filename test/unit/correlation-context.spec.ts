import {
  getCorrelationId,
  runWithCorrelationId,
  runWithCorrelationIdAsync,
} from '../../src/platform/logging/correlation-context';

describe('correlation AsyncLocalStorage context', () => {
  it('returns undefined outside a correlation context', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('propagates the correlation id through synchronous calls', () => {
    runWithCorrelationId('cor-sync-1', () => {
      expect(getCorrelationId()).toBe('cor-sync-1');
    });
    expect(getCorrelationId()).toBeUndefined();
  });

  it('propagates the correlation id across awaited async boundaries', async () => {
    await runWithCorrelationIdAsync('cor-async-1', async () => {
      await Promise.resolve();
      expect(getCorrelationId()).toBe('cor-async-1');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getCorrelationId()).toBe('cor-async-1');
    });
    expect(getCorrelationId()).toBeUndefined();
  });

  it('isolates nested correlation contexts', async () => {
    await runWithCorrelationIdAsync('outer', async () => {
      expect(getCorrelationId()).toBe('outer');
      await runWithCorrelationIdAsync('inner', async () => {
        expect(getCorrelationId()).toBe('inner');
      });
      expect(getCorrelationId()).toBe('outer');
    });
  });
});
