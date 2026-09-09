import { isUuid } from '../ids/uuid-v7';
import { paginationInvalid } from './project-scope';

export const CURSOR_VERSION = 1;
export const CURSOR_SORT = 'id';
export const PAGINATION_MAX_LIMIT = 100;
export const PAGINATION_DEFAULT_LIMIT = 50;

export interface CursorPayload {
  readonly v: number;
  readonly sort: string;
  readonly id: string;
}

export function encodeCursor(id: string, sort = CURSOR_SORT): string {
  const payload: CursorPayload = { v: CURSOR_VERSION, sort, id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(
  raw: string,
  expectedSort = CURSOR_SORT,
  module = 'api',
): { readonly id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw paginationInvalid(module);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw paginationInvalid(module);
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== CURSOR_VERSION) {
    throw paginationInvalid(module);
  }
  if (record.sort !== expectedSort) {
    throw paginationInvalid(module);
  }
  if (typeof record.id !== 'string' || !isUuid(record.id)) {
    throw paginationInvalid(module);
  }
  return { id: record.id };
}

export function parseLimit(raw: unknown, module = 'api'): number {
  if (raw === undefined || raw === null || raw === '') {
    return PAGINATION_DEFAULT_LIMIT;
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > PAGINATION_MAX_LIMIT) {
    throw paginationInvalid(module);
  }
  return value;
}
