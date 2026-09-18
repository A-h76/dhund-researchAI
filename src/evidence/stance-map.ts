export type GatewayStanceLabel = 'support' | 'oppose' | 'neutral' | 'unresolved';

export type StoredEvidenceStance = 'supports' | 'contradicts' | 'neutral' | 'unresolved';

/** Never coerce unresolved → neutral. Unknown labels become unresolved, not a guessed polarity. */
export function toStoredStance(label: string): StoredEvidenceStance {
  switch (label) {
    case 'support':
    case 'supports':
      return 'supports';
    case 'oppose':
    case 'contradicts':
      return 'contradicts';
    case 'neutral':
      return 'neutral';
    case 'unresolved':
      return 'unresolved';
    default:
      return 'unresolved';
  }
}

export function stanceDistribution(
  stances: readonly StoredEvidenceStance[],
): {
  supports: number;
  contradicts: number;
  neutral: number;
  unresolved: number;
  unresolvedShare: number;
} {
  const counts = {
    supports: 0,
    contradicts: 0,
    neutral: 0,
    unresolved: 0,
  };
  for (const stance of stances) {
    counts[stance] += 1;
  }
  const total = stances.length;
  return {
    ...counts,
    unresolvedShare: total === 0 ? 0 : counts.unresolved / total,
  };
}
