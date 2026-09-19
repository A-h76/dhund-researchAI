import {
  assertResearchRunCoverageForFinalize,
  computeFinalResearchRunCoverage,
  emptyResearchRunCoverage,
  hashResearchRunCoverage,
  isFullResearchRunCoverage,
  parseResearchRunCoverage,
  ResearchRunCoverageError,
} from '../../src/l0/ports/research-run-coverage';
import {
  aggregateResearchRunStepOutcomes,
} from '../../src/l0/ports/research-run-step-outcomes';

const fullCoverage = {
  schemaVersion: 1 as const,
  discovery: {
    requested: 10,
    discovered: 10,
    eligible: 8,
    excluded: 2,
    included: 8,
  },
  processing: {
    requested: 8,
    admitted: 8,
    completed: 8,
    partial: 0,
    failed: 0,
    unresolved: 0,
  },
};

const partialCoverage = {
  schemaVersion: 1 as const,
  discovery: {
    requested: 100,
    discovered: 100,
    eligible: 100,
    excluded: 0,
    included: 100,
  },
  processing: {
    requested: 100,
    admitted: 100,
    completed: 40,
    partial: 0,
    failed: 10,
    unresolved: 50,
  },
};

describe('GAP-COVERAGE-01 frozen two-funnel schema (DHB-67)', () => {
  it('accepts exactly { schemaVersion, discovery, processing }', () => {
    expect(assertResearchRunCoverageForFinalize(fullCoverage)).toEqual(fullCoverage);
  });

  it('rejects retired corpus vocabulary', () => {
    expect(() =>
      parseResearchRunCoverage({
        ...emptyResearchRunCoverage(),
        corpus: { size: 1 },
      }),
    ).toThrow(/corpus/);
    expect(() =>
      assertResearchRunCoverageForFinalize({
        ...fullCoverage,
        corpus: { size: 1 },
      }),
    ).toThrow(ResearchRunCoverageError);
  });

  it('rejects Funnel-B step-outcome keys inside processing', () => {
    for (const forbidden of ['succeeded', 'skipped', 'cancelled'] as const) {
      expect(() =>
        parseResearchRunCoverage({
          schemaVersion: 1,
          discovery: fullCoverage.discovery,
          processing: { ...fullCoverage.processing, [forbidden]: 1 },
        }),
      ).toThrow(new RegExp(forbidden));
    }
  });

  it('keeps stepOutcomes outside coverage as a separate aggregate', () => {
    expect(() =>
      parseResearchRunCoverage({
        ...fullCoverage,
        stepOutcomes: { succeeded: 1, failed: 0, skipped: 0, cancelled: 0 },
      }),
    ).toThrow(/stepOutcomes must not appear inside coverage/);

    const outcomes = aggregateResearchRunStepOutcomes({
      ready: 0,
      inFlight: 0,
      pending: 0,
      deferred: 3,
      succeeded: 7,
      failed: 1,
      cancelled: 0,
    });
    expect(outcomes).toEqual({
      succeeded: 7,
      failed: 1,
      skipped: 3,
      cancelled: 0,
    });
    expect('stepOutcomes' in fullCoverage).toBe(false);
  });

  it('rejects finalize when a funnel denominator is missing', () => {
    expect(() =>
      assertResearchRunCoverageForFinalize({
        schemaVersion: 1,
        discovery: {
          discovered: 1,
          eligible: 1,
          excluded: 0,
          included: 1,
        },
        processing: fullCoverage.processing,
      }),
    ).toThrow(/missing required counter "requested"/);

    expect(() =>
      assertResearchRunCoverageForFinalize({
        schemaVersion: 1,
        discovery: fullCoverage.discovery,
        processing: {
          admitted: 1,
          completed: 1,
          partial: 0,
          failed: 0,
          unresolved: 0,
        },
      }),
    ).toThrow(/missing required counter "requested"/);
  });

  it('rejects extra top-level keys on finalize', () => {
    expect(() =>
      assertResearchRunCoverageForFinalize({
        ...fullCoverage,
        percentComplete: 40,
      }),
    ).toThrow(/exactly \{ schemaVersion, discovery, processing \}/);
  });

  it('computes full vs partial honestly from per-funnel counters', () => {
    expect(isFullResearchRunCoverage(fullCoverage)).toBe(true);
    expect(isFullResearchRunCoverage(partialCoverage)).toBe(false);
    expect(computeFinalResearchRunCoverage(partialCoverage)).toEqual(partialCoverage);
  });

  it('coverage_snapshot_hash is stable for identical coverage and changes on any counter', () => {
    const a = hashResearchRunCoverage(fullCoverage);
    const b = hashResearchRunCoverage({ ...fullCoverage });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);

    const changed = hashResearchRunCoverage({
      ...fullCoverage,
      processing: { ...fullCoverage.processing, completed: 7 },
    });
    expect(changed).not.toBe(a);
  });
});
