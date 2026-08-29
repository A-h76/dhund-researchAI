export type CorrelationIdReader = () => string | undefined;

export const CORRELATION_ID_READER = Symbol('CORRELATION_ID_READER');

export interface SlowQueryEvent {
  readonly durationMs: number;
  readonly operation: string;
  readonly model?: string;
  readonly correlationId?: string;
}

export interface QueryObserver {
  onSlowQuery(event: SlowQueryEvent): void;
}

export const QUERY_OBSERVER = Symbol('QUERY_OBSERVER');

/** Queries at or above this duration are observed as slow (DHB-28). */
export const SLOW_QUERY_THRESHOLD_MS = 500;

export function isSlowQuery(
  durationMs: number,
  thresholdMs: number = SLOW_QUERY_THRESHOLD_MS,
): boolean {
  return durationMs >= thresholdMs;
}
