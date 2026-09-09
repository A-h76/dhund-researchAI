import { DomainError, ErrorCode } from '../platform/errors';

const MODULE = 'ingestion';

function malformed(): DomainError {
  return new DomainError(ErrorCode.MalformedRequest, { module: MODULE });
}

function invalid(): DomainError {
  return new DomainError(ErrorCode.ValidationError, { module: MODULE });
}

export function parseDocumentPatch(body: unknown): { title: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }
  const record = body as Record<string, unknown>;
  if (typeof record.title !== 'string') {
    throw invalid();
  }
  const title = record.title.trim();
  if (title.length === 0) {
    throw invalid();
  }
  return { title };
}
