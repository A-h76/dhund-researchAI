/**
 * GAP-USAGE-PERIOD-01.
 * Usage follows the Stripe billing period, not the calendar month.
 * When Stripe has no period, the fallback key is `unscoped` (a fixed window,
 * not YYYY-MM). Callers must keep the existing counter value. Writing zero
 * over a positive counter is data loss and is rejected by the rollup.
 */
export const MISSING_STRIPE_PERIOD_KEY = 'unscoped';

const FALLBACK_START = new Date('1970-01-01T00:00:00.000Z');
const FALLBACK_END = new Date('9999-01-01T00:00:00.000Z');

export interface UsagePeriod {
  readonly period: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly source: 'stripe' | 'fallback';
}

export function usagePeriodFromStripe(start: Date | null, end: Date | null): UsagePeriod {
  if (start === null || end === null || end.getTime() <= start.getTime()) {
    return {
      period: MISSING_STRIPE_PERIOD_KEY,
      periodStart: FALLBACK_START,
      periodEnd: FALLBACK_END,
      source: 'fallback',
    };
  }
  return {
    period: `${start.toISOString()}/${end.toISOString()}`,
    periodStart: start,
    periodEnd: end,
    source: 'stripe',
  };
}

export function isCalendarMonthPeriod(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period);
}
