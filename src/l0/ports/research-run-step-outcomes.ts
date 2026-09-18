import type { ResearchRunStepCounts } from './research-run-store.port';

/**
 * Step outcomes are aggregated FROM research_run_steps and never live inside
 * coverage (GAP-COVERAGE-01). Coverage counts documents; this counts steps.
 *
 * Phase 7 ResearchRunStep DEFERRED outcome: DEFERRED at termination = skipped.
 */
export interface ResearchRunStepOutcomes {
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cancelled: number;
}

export function emptyResearchRunStepOutcomes(): ResearchRunStepOutcomes {
  return {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  };
}

export function aggregateResearchRunStepOutcomes(
  counts: ResearchRunStepCounts,
): ResearchRunStepOutcomes {
  return {
    succeeded: counts.succeeded,
    failed: counts.failed,
    skipped: counts.deferred,
    cancelled: counts.cancelled,
  };
}
