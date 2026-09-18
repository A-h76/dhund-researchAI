/**
 * Frozen two-funnel coverage (Phase 2 §5.10 / GAP-COVERAGE-01).
 * Never collapsed to a percentage; no `corpus` vocabulary.
 */

export interface ResearchRunCoverage {
  readonly schemaVersion: 1;
  readonly discovery: {
    readonly requested: number;
    readonly discovered: number;
    readonly eligible: number;
    readonly excluded: number;
    readonly included: number;
  };
  readonly processing: {
    readonly requested: number;
    readonly admitted: number;
    readonly completed: number;
    readonly partial: number;
    readonly failed: number;
    readonly unresolved: number;
  };
}

export function emptyResearchRunCoverage(): ResearchRunCoverage {
  return {
    schemaVersion: 1,
    discovery: {
      requested: 0,
      discovered: 0,
      eligible: 0,
      excluded: 0,
      included: 0,
    },
    processing: {
      requested: 0,
      admitted: 0,
      completed: 0,
      partial: 0,
      failed: 0,
      unresolved: 0,
    },
  };
}

/**
 * Full coverage: every included document completed with no partial/failed/unresolved.
 * Empty included/admitted corpora that reached COMPLETING count as full.
 */
export function isFullResearchRunCoverage(coverage: ResearchRunCoverage): boolean {
  const { discovery, processing } = coverage;
  if (discovery.included === 0 && processing.admitted === 0) {
    return processing.failed === 0 && processing.partial === 0 && processing.unresolved === 0;
  }
  return (
    processing.failed === 0 &&
    processing.partial === 0 &&
    processing.unresolved === 0 &&
    processing.completed === processing.admitted &&
    processing.admitted === discovery.included
  );
}

export function parseResearchRunCoverage(value: unknown): ResearchRunCoverage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return emptyResearchRunCoverage();
  }
  const record = value as Record<string, unknown>;
  if ('corpus' in record) {
    throw new Error('Retired coverage vocabulary "corpus" is forbidden (GAP-COVERAGE-01)');
  }
  if ('stepOutcomes' in record) {
    throw new Error('stepOutcomes must not appear inside coverage (GAP-COVERAGE-01)');
  }
  const discovery = asFunnel(record.discovery, [
    'requested',
    'discovered',
    'eligible',
    'excluded',
    'included',
  ]);
  const processing = asFunnel(record.processing, [
    'requested',
    'admitted',
    'completed',
    'partial',
    'failed',
    'unresolved',
  ]);
  if (typeof record.processing === 'object' && record.processing !== null) {
    const processingRecord = record.processing as Record<string, unknown>;
    for (const forbidden of ['succeeded', 'skipped', 'cancelled'] as const) {
      if (forbidden in processingRecord) {
        throw new Error(
          `Retired Funnel-B counter "${forbidden}" must not appear inside coverage.processing (GAP-COVERAGE-01)`,
        );
      }
    }
  }
  return {
    schemaVersion: 1,
    discovery: {
      requested: discovery.requested,
      discovered: discovery.discovered,
      eligible: discovery.eligible,
      excluded: discovery.excluded,
      included: discovery.included,
    },
    processing: {
      requested: processing.requested,
      admitted: processing.admitted,
      completed: processing.completed,
      partial: processing.partial,
      failed: processing.failed,
      unresolved: processing.unresolved,
    },
  };
}

function asFunnel(
  value: unknown,
  keys: readonly string[],
): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return Object.fromEntries(keys.map((key) => [key, 0]));
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of keys) {
    const raw = record[key];
    out[key] = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
  }
  return out;
}
