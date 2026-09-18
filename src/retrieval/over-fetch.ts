/**
 * v1 over-fetch applied to each retrieval arm's LIMIT. Compensates for ANN
 * graph-walk / FTS recall lost to the eligibility predicate — it is not a
 * post-fusion filter window.
 */
export const RETRIEVAL_OVER_FETCH_FACTOR = 3;
export const RETRIEVAL_K_DEFAULT = 10;
export const RETRIEVAL_K_MAX = 100;

export class InvalidRetrievalKError extends Error {
  constructor(readonly value: number) {
    super(`retrieval k must be an integer between 1 and ${RETRIEVAL_K_MAX}`);
    this.name = 'InvalidRetrievalKError';
  }
}

export function armLimit(
  k: number,
  factor: number = RETRIEVAL_OVER_FETCH_FACTOR,
): number {
  if (!Number.isInteger(k) || k < 1 || k > RETRIEVAL_K_MAX) {
    throw new InvalidRetrievalKError(k);
  }
  return k * factor;
}
