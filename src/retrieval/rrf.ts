import type { RankedCandidate, RetrievalCandidate } from './retrieval.port';

/** Cormack et al. RRF constant. Not the over-fetch factor f. */
export const RRF_K = 60;

export class FusionBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FusionBoundaryError';
  }
}

export interface FusedCandidate {
  readonly chunkId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly text: string;
  readonly rrfScore: number;
}

/**
 * Fusion sees arm hits only. Eligibility already ran in SQL (DHB-55). This
 * checks identity completeness — it does not re-evaluate deleted/retired/rights.
 */
export function assertFusionBoundary(
  vectorHits: readonly RetrievalCandidate[],
  ftsHits: readonly RetrievalCandidate[],
): void {
  for (const hit of [...vectorHits, ...ftsHits]) {
    if (hit.chunkId.length === 0 || hit.projectId.length === 0 || hit.documentId.length === 0) {
      throw new FusionBoundaryError('fusion input is missing candidate identity');
    }
  }
}

/** Always 0: ineligible rows never leave the arm SQL. */
export function ineligibleCountAtFusionBoundary(
  vectorHits: readonly RetrievalCandidate[],
  ftsHits: readonly RetrievalCandidate[],
): number {
  assertFusionBoundary(vectorHits, ftsHits);
  return 0;
}

export function fuseRrf(
  vectorHits: readonly RetrievalCandidate[],
  ftsHits: readonly RetrievalCandidate[],
): readonly FusedCandidate[] {
  assertFusionBoundary(vectorHits, ftsHits);
  const scores = new Map<string, FusedCandidate>();
  addArm(scores, vectorHits);
  addArm(scores, ftsHits);
  return [...scores.values()].sort(compareFused);
}

export function orderByScores(
  fused: readonly FusedCandidate[],
  scores: readonly number[],
): RankedCandidate[] {
  return fused
    .map((candidate, index) => ({
      chunkId: candidate.chunkId,
      projectId: candidate.projectId,
      documentId: candidate.documentId,
      text: candidate.text,
      rrfScore: candidate.rrfScore,
      rerankScore: scores[index] ?? 0,
    }))
    .sort(compareRanked);
}

function addArm(
  scores: Map<string, FusedCandidate>,
  hits: readonly RetrievalCandidate[],
): void {
  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index];
    if (hit === undefined) {
      continue;
    }
    const contribution = 1 / (RRF_K + index + 1);
    const existing = scores.get(hit.chunkId);
    if (existing === undefined) {
      scores.set(hit.chunkId, {
        chunkId: hit.chunkId,
        projectId: hit.projectId,
        documentId: hit.documentId,
        text: hit.text,
        rrfScore: contribution,
      });
      continue;
    }
    scores.set(hit.chunkId, {
      ...existing,
      text: existing.text.length > 0 ? existing.text : hit.text,
      rrfScore: existing.rrfScore + contribution,
    });
  }
}

function compareFused(a: FusedCandidate, b: FusedCandidate): number {
  if (a.rrfScore !== b.rrfScore) {
    return b.rrfScore - a.rrfScore;
  }
  return a.chunkId.localeCompare(b.chunkId);
}

function compareRanked(a: RankedCandidate, b: RankedCandidate): number {
  if (a.rerankScore !== b.rerankScore) {
    return b.rerankScore - a.rerankScore;
  }
  if (a.rrfScore !== b.rrfScore) {
    return b.rrfScore - a.rrfScore;
  }
  return a.chunkId.localeCompare(b.chunkId);
}
