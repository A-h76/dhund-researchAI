export const RETRIEVAL_RATE_LIMIT_CLASS = 'retrieval';
export const RETRIEVAL_RATE_LIMIT_MAX = 60;
export const RETRIEVAL_RATE_LIMIT_TTL_SECONDS = 60;

export function retrievalRateLimitKey(orgId: string, userId: string): string {
  return `${RETRIEVAL_RATE_LIMIT_CLASS}:${orgId}:${userId}`;
}
