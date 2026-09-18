import { toStoredStance, stanceDistribution } from '../../src/evidence/stance-map';

describe('DHB-59 stance mapping (§11.4)', () => {
  it('stores unresolved as unresolved and never coerces it to neutral', () => {
    expect(toStoredStance('unresolved')).toBe('unresolved');
    expect(toStoredStance('unresolved')).not.toBe('neutral');
    expect(toStoredStance('neutral')).toBe('neutral');
  });

  it('maps support/oppose without dropping either polarity', () => {
    expect(toStoredStance('support')).toBe('supports');
    expect(toStoredStance('oppose')).toBe('contradicts');
  });

  it('counts unresolved in its own denominator', () => {
    const distribution = stanceDistribution([
      'supports',
      'contradicts',
      'unresolved',
      'unresolved',
    ]);
    expect(distribution.unresolved).toBe(2);
    expect(distribution.unresolvedShare).toBe(0.5);
    expect(distribution.neutral).toBe(0);
  });
});
