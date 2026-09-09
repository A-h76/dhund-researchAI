import { Injectable, type NestMiddleware } from '@nestjs/common';
import { DomainError, ErrorCode } from '../errors';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  parseCookieHeader,
  REFRESH_COOKIE_NAME,
} from './auth-cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface CsrfRequestLike {
  readonly method?: string;
  readonly headers: Record<string, unknown>;
}

type NextFunction = (error?: unknown) => void;

export function csrfExpressMiddleware(
  req: CsrfRequestLike,
  _res: unknown,
  next: NextFunction,
): void {
  try {
    assertCsrf(req);
    next();
  } catch (error) {
    next(error);
  }
}

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: CsrfRequestLike, _res: unknown, next: NextFunction): void {
    csrfExpressMiddleware(req, _res, next);
  }
}

function assertCsrf(req: CsrfRequestLike): void {
  const method = (req.method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return;
  }

  if (hasBearerAuthorization(req.headers.authorization)) {
    return;
  }

  const cookies = parseCookieHeader(headerValue(req.headers.cookie));
  if (cookies[REFRESH_COOKIE_NAME] === undefined || cookies[REFRESH_COOKIE_NAME].length === 0) {
    return;
  }

  const presented = headerValue(req.headers[CSRF_HEADER_NAME]);
  const expected = cookies[CSRF_COOKIE_NAME];
  if (presented === undefined || expected === undefined || presented !== expected) {
    throw new DomainError(ErrorCode.CsrfInvalid, { module: 'http' });
  }
}

function hasBearerAuthorization(value: unknown): boolean {
  const header = headerValue(value);
  if (header === undefined) {
    return false;
  }
  return /^Bearer\s+\S+$/i.test(header.trim());
}

function headerValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}
