import { randomUUID } from 'node:crypto';
import { CORRELATION_ID_HEADER } from './error-envelope';

export function resolveCorrelationId(headerValue: unknown): string {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof raw !== 'string') {
    return randomUUID();
  }

  const sanitized = raw.replace(/[\r\n]/g, '').trim();
  if (sanitized.length === 0 || sanitized.length > 128) {
    return randomUUID();
  }

  return sanitized;
}

export function readCorrelationHeader(
  headers: Record<string, unknown> | undefined,
): unknown {
  if (headers === undefined) {
    return undefined;
  }

  return (
    headers[CORRELATION_ID_HEADER] ??
    headers['X-Correlation-Id'] ??
    headers['X-Correlation-ID']
  );
}
