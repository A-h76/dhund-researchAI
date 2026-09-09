import type { AccessContext } from '../../platform/authorization/access-context';
import { ACCESS_CONTEXT_KEY, ACCESS_USER_ID_KEY } from './metadata';

export interface AccessAwareRequest {
  method?: string;
  headers?: Record<string, unknown>;
  params?: Record<string, string | undefined>;
  [ACCESS_USER_ID_KEY]?: string;
  [ACCESS_CONTEXT_KEY]?: AccessContext;
}

export function readAuthorizationHeader(
  request: AccessAwareRequest,
): string | undefined {
  const headers = request.headers;
  if (headers === undefined) {
    return undefined;
  }
  const raw = headers.authorization ?? headers.Authorization;
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    return raw[0];
  }
  return undefined;
}

export function readPathParam(
  request: AccessAwareRequest,
  name: string,
): string | undefined {
  const value = request.params?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
