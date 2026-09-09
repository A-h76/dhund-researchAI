export const ACCESS_CONTEXT_CACHE_ORG_ID = '__platform__';
export const ACCESS_CONTEXT_CACHE_TTL_SECONDS = 60;

export function accessContextCacheKey(userId: string): string {
  return `ac:${userId}`;
}
