/**
 * Canonical filteredRecallShortfall (DHB-54 / DHB-56 / DHB-85 / DHB-93).
 *
 * candidates returned by the retrieval arms, minus the candidates surviving
 * the combined eligibility + authorization filtering, measured before the
 * final top-k result.
 *
 * Tuning signal for over-fetch factor f: a drop rate above the threshold
 * means f should increase.
 */
export const FILTERED_RECALL_SHORTFALL_THRESHOLD = 0.3;

export function filteredRecallShortfall(
  retrievedCount: number,
  survivingCount: number,
): number {
  return Math.max(0, retrievedCount - survivingCount);
}

export function filteredRecallDropRate(
  retrievedCount: number,
  survivingCount: number,
): number {
  if (retrievedCount <= 0) {
    return 0;
  }
  return filteredRecallShortfall(retrievedCount, survivingCount) / retrievedCount;
}
