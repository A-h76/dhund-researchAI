export const CHAT_RATE_LIMIT_MAX = 30;
export const CHAT_RATE_LIMIT_TTL_SECONDS = 60;

export function chatRateLimitKey(orgId: string, userId: string): string {
  return `rate:chat:${orgId}:${userId}`;
}
