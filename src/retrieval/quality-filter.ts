import type { EvidenceLookupResult, EvidenceLookupRow } from '../l0/ports';
import type { QualityAnnotation, SearchCandidate } from './retrieval.port';

/** v1 floor. Ticket does not specify a caller-supplied threshold. */
export const RETRIEVAL_QUALITY_MIN = 0.5;

export interface QualityFilterInput {
  readonly includeUnresolved: boolean;
  readonly minScore?: number;
}

/**
 * Drops below-threshold evidence and unresolved stance unless the caller opts
 * in. Raw candidates (no Evidence row) are kept and must not be treated as
 * unresolved.
 */
export function applyQualityFilter(
  candidates: readonly SearchCandidate[],
  lookup: EvidenceLookupResult,
  input: QualityFilterInput,
): SearchCandidate[] {
  const minScore = input.minScore ?? RETRIEVAL_QUALITY_MIN;
  const byChunk = new Map<string, EvidenceLookupRow[]>();
  for (const row of lookup.evidence) {
    const bucket = byChunk.get(row.chunkId);
    if (bucket === undefined) {
      byChunk.set(row.chunkId, [row]);
      continue;
    }
    bucket.push(row);
  }

  const kept: SearchCandidate[] = [];
  for (const candidate of candidates) {
    const rows = byChunk.get(candidate.chunkId) ?? [];
    if (rows.length === 0) {
      kept.push(candidate);
      continue;
    }
    const surviving = rows.filter((row) =>
      passesQuality(row, input.includeUnresolved, minScore),
    );
    if (surviving.length === 0) {
      continue;
    }
    kept.push({
      ...candidate,
      evidenceRefs: surviving.map((row) => row.id),
      qualityAnnotation: annotationFor(surviving),
    });
  }
  return kept;
}

function passesQuality(
  row: EvidenceLookupRow,
  includeUnresolved: boolean,
  minScore: number,
): boolean {
  if (row.qualityScore < minScore) {
    return false;
  }
  if (row.stance === 'unresolved' && !includeUnresolved) {
    return false;
  }
  return true;
}

function annotationFor(rows: readonly EvidenceLookupRow[]): QualityAnnotation {
  if (rows.some((row) => row.type === 'body_grounded')) {
    return 'body_grounded';
  }
  return 'metadata_only';
}
