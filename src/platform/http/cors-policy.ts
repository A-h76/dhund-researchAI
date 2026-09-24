export type CorsDecision = 'absent' | 'allow' | 'reject';

/** Browser origins must be an explicit allow-list entry. Credentials are never paired with `*`. */
export function decideCors(origin: string | undefined, allowedOrigins: readonly string[]): CorsDecision {
  if (origin === undefined || origin.length === 0) {
    return 'absent';
  }
  if (allowedOrigins.includes('*')) {
    return 'reject';
  }
  return allowedOrigins.includes(origin) ? 'allow' : 'reject';
}

export function parseAllowedOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== '*');
}
