/**
 * v1 over-fetch applied to each retrieval arm's LIMIT. Compensates for ANN
 * graph-walk / FTS recall lost to the eligibility predicate — it is not a
 * post-fusion filter window.
 */
export const RETRIEVAL_OVER_FETCH_FACTOR = 3;

export class InvalidRetrievalKError extends Error {
  constructor(readonly value: number) {
    super('retrieval k must be a positive integer');
    this.name = 'InvalidRetrievalKError';
  }
}

export function armLimit(
  k: number,
  factor: number = RETRIEVAL_OVER_FETCH_FACTOR,
): number {
  if (!Number.isInteger(k) || k < 1) {
    throw new InvalidRetrievalKError(k);
  }
  return k * factor;
}
