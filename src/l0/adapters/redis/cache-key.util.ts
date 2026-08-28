function sanitizeSegment(value: string): string {
  return value.replace(/[/\\:\0.]/g, '_').trim();
}

export function buildNamespacedCacheKey(orgId: string, key: string): string {
  const sanitizedOrg = sanitizeSegment(orgId);
  const sanitizedKey = sanitizeSegment(key);

  if (sanitizedOrg.length === 0) {
    throw new Error('orgId must not be empty');
  }

  if (sanitizedKey.length === 0) {
    throw new Error('key must not be empty');
  }

  return `org:${sanitizedOrg}:${sanitizedKey}`;
}
