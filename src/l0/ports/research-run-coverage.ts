/**
 * Frozen two-funnel coverage (Phase 2 §5.10 / GAP-COVERAGE-01).
 * Never collapsed to a percentage; no `corpus` vocabulary.
 * Exactly `{ schemaVersion, discovery, processing }` — nothing else.
 */

import { createHash } from 'node:crypto';

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

/** Discovery funnel denominator — documents asked of the discovery path. */
export const DISCOVERY_DENOMINATOR_KEY = 'requested' as const;

/** Processing funnel denominator — documents asked of the processing path. */
export const PROCESSING_DENOMINATOR_KEY = 'requested' as const;

const DISCOVERY_KEYS = [
  'requested',
  'discovered',
  'eligible',
  'excluded',
  'included',
] as const;

const PROCESSING_KEYS = [
  'requested',
  'admitted',
  'completed',
  'partial',
  'failed',
  'unresolved',
] as const;

const FORBIDDEN_PROCESSING_KEYS = ['succeeded', 'skipped', 'cancelled'] as const;

export class ResearchRunCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchRunCoverageError';
  }
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

/**
 * Lenient read path for persisted JSON (empty `{}` → zeros).
 * Still rejects retired vocabulary (corpus / stepOutcomes / Funnel-B keys).
 */
export function parseResearchRunCoverage(value: unknown): ResearchRunCoverage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return emptyResearchRunCoverage();
  }
  const record = value as Record<string, unknown>;
  assertForbiddenCoverageKeys(record);
  const discovery = asFunnel(record.discovery, DISCOVERY_KEYS);
  const processing = asFunnel(record.processing, PROCESSING_KEYS);
  assertForbiddenProcessingKeys(record.processing);
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

/**
 * Strict finalize path (GAP-COVERAGE-01): rejects missing denominators and
 * any shape that is not exactly `{ schemaVersion, discovery, processing }`.
 */
export function assertResearchRunCoverageForFinalize(
  value: unknown,
): ResearchRunCoverage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ResearchRunCoverageError(
      'Coverage must be an object with schemaVersion, discovery, and processing',
    );
  }
  const record = value as Record<string, unknown>;
  assertForbiddenCoverageKeys(record);

  const topKeys = Object.keys(record).sort();
  const expectedTop = ['discovery', 'processing', 'schemaVersion'];
  if (topKeys.length !== expectedTop.length || topKeys.some((k, i) => k !== expectedTop[i])) {
    throw new ResearchRunCoverageError(
      'Coverage object must be exactly { schemaVersion, discovery, processing } (GAP-COVERAGE-01)',
    );
  }

  if (record.schemaVersion !== 1) {
    throw new ResearchRunCoverageError('Coverage schemaVersion must be 1');
  }

  const discovery = requireFunnel(record.discovery, DISCOVERY_KEYS, 'discovery');
  const processing = requireFunnel(record.processing, PROCESSING_KEYS, 'processing');
  assertForbiddenProcessingKeys(record.processing);

  if (!(DISCOVERY_DENOMINATOR_KEY in (record.discovery as object))) {
    throw new ResearchRunCoverageError(
      `Coverage discovery is missing denominator "${DISCOVERY_DENOMINATOR_KEY}"`,
    );
  }
  if (!(PROCESSING_DENOMINATOR_KEY in (record.processing as object))) {
    throw new ResearchRunCoverageError(
      `Coverage processing is missing denominator "${PROCESSING_DENOMINATOR_KEY}"`,
    );
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

/**
 * COMPLETING computes final coverage: validate + freeze the two-funnel snapshot
 * that will be persisted on the terminal transition.
 */
export function computeFinalResearchRunCoverage(
  coverage: ResearchRunCoverage,
): ResearchRunCoverage {
  return assertResearchRunCoverageForFinalize(coverage);
}

/**
 * Stable sha256 over the frozen coverage shape. Identical coverage → identical
 * hash; any counter change → different hash (coverage_snapshot_hash).
 */
export function hashResearchRunCoverage(coverage: ResearchRunCoverage): string {
  const frozen = assertResearchRunCoverageForFinalize(coverage);
  return createHash('sha256').update(canonicalCoverageJson(frozen)).digest('hex');
}

function canonicalCoverageJson(coverage: ResearchRunCoverage): string {
  // Fixed key order — frozen schema, no sort variance.
  return JSON.stringify({
    schemaVersion: coverage.schemaVersion,
    discovery: {
      requested: coverage.discovery.requested,
      discovered: coverage.discovery.discovered,
      eligible: coverage.discovery.eligible,
      excluded: coverage.discovery.excluded,
      included: coverage.discovery.included,
    },
    processing: {
      requested: coverage.processing.requested,
      admitted: coverage.processing.admitted,
      completed: coverage.processing.completed,
      partial: coverage.processing.partial,
      failed: coverage.processing.failed,
      unresolved: coverage.processing.unresolved,
    },
  });
}

function assertForbiddenCoverageKeys(record: Record<string, unknown>): void {
  if ('corpus' in record) {
    throw new ResearchRunCoverageError(
      'Retired coverage vocabulary "corpus" is forbidden (GAP-COVERAGE-01)',
    );
  }
  if ('stepOutcomes' in record) {
    throw new ResearchRunCoverageError(
      'stepOutcomes must not appear inside coverage (GAP-COVERAGE-01)',
    );
  }
}

function assertForbiddenProcessingKeys(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return;
  }
  const processingRecord = value as Record<string, unknown>;
  for (const forbidden of FORBIDDEN_PROCESSING_KEYS) {
    if (forbidden in processingRecord) {
      throw new ResearchRunCoverageError(
        `Retired Funnel-B counter "${forbidden}" must not appear inside coverage.processing (GAP-COVERAGE-01)`,
      );
    }
  }
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

function requireFunnel(
  value: unknown,
  keys: readonly string[],
  funnelName: string,
): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ResearchRunCoverageError(`Coverage.${funnelName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of keys) {
    if (!(key in record)) {
      throw new ResearchRunCoverageError(
        `Coverage.${funnelName} is missing required counter "${key}"`,
      );
    }
    const raw = record[key];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      throw new ResearchRunCoverageError(
        `Coverage.${funnelName}.${key} must be a non-negative integer`,
      );
    }
    out[key] = raw;
  }
  return out;
}
