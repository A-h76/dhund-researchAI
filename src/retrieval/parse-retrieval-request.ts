import { DomainError, ErrorCode } from '../platform/errors';
import { RETRIEVAL_K_DEFAULT, RETRIEVAL_K_MAX } from './over-fetch';

const MODULE = 'retrieval';

export interface ParsedRetrievalSearchRequest {
  readonly query: string;
  readonly k: number;
  readonly includeUnresolved: boolean;
}

function malformed(): DomainError {
  return new DomainError(ErrorCode.MalformedRequest, { module: MODULE });
}

function invalid(): DomainError {
  return new DomainError(ErrorCode.ValidationError, { module: MODULE });
}

export function parseRetrievalSearchRequest(body: unknown): ParsedRetrievalSearchRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }
  const record = body as Record<string, unknown>;
  if (typeof record.query !== 'string') {
    throw malformed();
  }
  const query = record.query.trim();
  if (query.length === 0) {
    throw invalid();
  }
  const k = parseK(record);
  const includeUnresolved = parseIncludeUnresolved(record.includeUnresolved);
  return { query, k, includeUnresolved };
}

function parseK(record: Record<string, unknown>): number {
  if (record.k === undefined && record.limit === undefined) {
    return RETRIEVAL_K_DEFAULT;
  }
  const raw = record.k ?? record.limit;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > RETRIEVAL_K_MAX) {
    throw invalid();
  }
  if (record.k !== undefined && record.limit !== undefined && record.k !== record.limit) {
    throw invalid();
  }
  return raw;
}

function parseIncludeUnresolved(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw invalid();
  }
  return value;
}
