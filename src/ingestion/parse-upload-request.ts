import { DomainError, ErrorCode } from '../platform/errors';
import { ALLOWED_UPLOAD_MIME_TYPE } from './upload.constants';
import { assertAllowedMimeType, assertUploadFilename, assertUploadSize } from './upload-validation';

const MODULE = 'ingestion';

export interface ParsedUploadCreateRequest {
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

function malformed(): DomainError {
  return new DomainError(ErrorCode.MalformedRequest, { module: MODULE });
}

function invalid(): DomainError {
  return new DomainError(ErrorCode.ValidationError, { module: MODULE });
}

export function parseUploadCreateRequest(body: unknown): ParsedUploadCreateRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }
  const record = body as Record<string, unknown>;
  if (typeof record.filename !== 'string' || typeof record.mimeType !== 'string') {
    throw malformed();
  }
  if (typeof record.sizeBytes !== 'number' || !Number.isSafeInteger(record.sizeBytes)) {
    throw malformed();
  }
  const filename = record.filename.trim();
  const mimeType = record.mimeType.trim().toLowerCase();
  if (filename.length === 0 || mimeType.length === 0) {
    throw invalid();
  }
  if (record.sizeBytes < 1) {
    throw invalid();
  }
  assertUploadFilename(filename);
  assertAllowedMimeType(mimeType);
  assertUploadSize(record.sizeBytes);
  return {
    filename,
    mimeType: ALLOWED_UPLOAD_MIME_TYPE,
    sizeBytes: record.sizeBytes,
  };
}

const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;

export interface ParsedUploadCompleteRequest {
  readonly doi: string | null;
}

/** Optional body: `{ doi?: string }`. DOI is normalized (URL prefix stripped, lowercased). */
export function parseUploadCompleteRequest(body: unknown): ParsedUploadCompleteRequest {
  if (body === undefined || body === null) {
    return { doi: null };
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw malformed();
  }
  const record = body as Record<string, unknown>;
  if (record.doi === undefined || record.doi === null) {
    return { doi: null };
  }
  if (typeof record.doi !== 'string') {
    throw malformed();
  }
  const doi = normalizeDoi(record.doi);
  if (doi === null) {
    throw invalid();
  }
  return { doi };
}

export function normalizeDoi(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
  if (!DOI_PATTERN.test(stripped)) {
    return null;
  }
  return stripped;
}

export function parseIdempotencyKey(header: string | undefined): string {
  if (header === undefined || header.trim().length === 0) {
    throw new DomainError(ErrorCode.IdempotencyKeyRequired, { module: MODULE });
  }
  return header.trim();
}
