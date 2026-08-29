import {
  emitSlowQuery,
  registerQueryObservability,
  resetQueryObservabilityForTests,
} from '../../src/l0/observability-bridge';
import { isSlowQuery, SLOW_QUERY_THRESHOLD_MS } from '../../src/l0/ports';

describe('slow query observability (DHB-28)', () => {
  let logs: string[];
  let consoleSpy: jest.SpyInstance;
  let observed: Array<Record<string, unknown>>;

  beforeEach(() => {
    logs = [];
    observed = [];
    consoleSpy = jest.spyOn(console, 'log').mockImplementation((line: string) => {
      logs.push(String(line));
    });
    registerQueryObservability({
      readCorrelationId: () => 'cor-slow-1',
      onSlowQuery: (event) => {
        observed.push(event as unknown as Record<string, unknown>);
      },
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    resetQueryObservabilityForTests();
  });

  it(`emits observation for queries >= ${SLOW_QUERY_THRESHOLD_MS}ms`, () => {
    emitSlowQuery({
      durationMs: SLOW_QUERY_THRESHOLD_MS,
      operation: 'findMany',
      model: 'PersistenceConventionFixture',
    });

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      durationMs: SLOW_QUERY_THRESHOLD_MS,
      operation: 'findMany',
      model: 'PersistenceConventionFixture',
      correlationId: 'cor-slow-1',
    });

    const payload = logs.join('\n');
    expect(payload).toContain('db.slow_query');
    expect(payload).not.toContain('SELECT');
    expect(payload).not.toContain('password');
    expect(payload).not.toContain('prompt');
  });

  it('does not treat sub-threshold durations as slow', () => {
    expect(SLOW_QUERY_THRESHOLD_MS).toBe(500);
    expect(isSlowQuery(499)).toBe(false);
    expect(isSlowQuery(500)).toBe(true);
  });
});
