export const RATE_LIMIT_CLASSES = [
  'auth',
  'retrieval',
  'ingestion',
  'research_runs',
  'general',
  'webhooks',
] as const;

export type RateLimitClass = (typeof RATE_LIMIT_CLASSES)[number];

export interface RateLimitBudget {
  readonly max: number;
  readonly ttlSeconds: number;
}

/** Auth is the only class that fails closed when Redis is unavailable (GAP-RATE-01). */
export const FAIL_CLOSED_RATE_LIMIT_CLASSES: ReadonlySet<RateLimitClass> = new Set(['auth']);

export const RATE_LIMIT_BUDGETS: Readonly<Record<RateLimitClass, RateLimitBudget>> = {
  auth: { max: 20, ttlSeconds: 60 },
  retrieval: { max: 60, ttlSeconds: 60 },
  ingestion: { max: 30, ttlSeconds: 60 },
  research_runs: { max: 10, ttlSeconds: 60 },
  general: { max: 120, ttlSeconds: 60 },
  webhooks: { max: 120, ttlSeconds: 60 },
};

export function rateLimitClassForPath(path: string | undefined): RateLimitClass {
  const value = (path ?? '').split('?')[0] ?? '';
  if (value.includes('/auth')) {
    return 'auth';
  }
  if (value.includes('/retrieval')) {
    return 'retrieval';
  }
  if (value.includes('/documents') || value.includes('/uploads')) {
    return 'ingestion';
  }
  if (value.includes('/capabilities') || value.includes('/research-runs')) {
    return 'research_runs';
  }
  if (value.includes('/webhooks')) {
    return 'webhooks';
  }
  return 'general';
}

export function failsClosedOnRedisOutage(rateClass: RateLimitClass): boolean {
  return FAIL_CLOSED_RATE_LIMIT_CLASSES.has(rateClass);
}
