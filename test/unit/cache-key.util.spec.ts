import { buildNamespacedCacheKey } from '../../src/l0/adapters/redis/cache-key.util';

describe('buildNamespacedCacheKey', () => {
  it('prefixes keys with org namespace', () => {
    expect(buildNamespacedCacheKey('org-1', 'session')).toBe('org:org-1:session');
  });

  it('sanitizes org and key segments', () => {
    expect(buildNamespacedCacheKey('org/1', 'key:with')).toBe('org:org_1:key_with');
  });

  it('rejects empty orgId', () => {
    expect(() => buildNamespacedCacheKey('', 'session')).toThrow('orgId must not be empty');
  });
});
