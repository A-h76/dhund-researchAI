import { DomainError, ErrorCode } from '../platform/errors';

const NOT_READY = new Set([
  'queued',
  'processing',
  'partial',
  'failed',
  'cancelled',
  'stale',
]);

export function assertDocumentReady(status: string): void {
  if (NOT_READY.has(status)) {
    throw new DomainError(ErrorCode.DocumentNotReady, { module: 'ingestion' });
  }
}
