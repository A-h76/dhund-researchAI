import type { ErrorCode } from './error-codes';

export interface ErrorEnvelope {
  code: ErrorCode;
  message?: string;
  details?: unknown;
  correlationId: string;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
