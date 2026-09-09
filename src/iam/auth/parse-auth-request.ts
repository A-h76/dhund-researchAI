import { DomainError } from '../../platform/errors/domain-error';
import { ErrorCode } from '../../platform/errors/error-codes';

export interface ParsedLoginRequest {
  readonly email: string;
  readonly password: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseLoginRequest(body: unknown): ParsedLoginRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }

  const record = body as Record<string, unknown>;
  if (typeof record.email !== 'string' || typeof record.password !== 'string') {
    throw malformed();
  }

  const email = record.email.trim();
  if (email.length === 0 || !EMAIL_PATTERN.test(email)) {
    throw malformed();
  }

  return { email, password: record.password };
}

export function parseEmailRequest(body: unknown): { email: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }

  const record = body as Record<string, unknown>;
  if (typeof record.email !== 'string') {
    throw malformed();
  }

  const email = record.email.trim();
  if (email.length === 0 || !EMAIL_PATTERN.test(email)) {
    throw malformed();
  }

  return { email };
}

export function parseTokenRequest(body: unknown): { token: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }

  const record = body as Record<string, unknown>;
  if (typeof record.token !== 'string' || record.token.length === 0) {
    throw malformed();
  }

  return { token: record.token };
}

export function parsePasswordResetRequest(body: unknown): {
  token: string;
  password: string;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }

  const record = body as Record<string, unknown>;
  if (typeof record.token !== 'string' || record.token.length === 0) {
    throw malformed();
  }
  if (typeof record.password !== 'string') {
    throw malformed();
  }

  return { token: record.token, password: record.password };
}

export function parseRefreshRequest(body: unknown): { refreshToken: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }

  const record = body as Record<string, unknown>;
  if (typeof record.refreshToken !== 'string') {
    throw malformed();
  }

  return { refreshToken: record.refreshToken };
}

export function readBearerToken(authorization: string | undefined): string {
  if (authorization === undefined || authorization.trim().length === 0) {
    throw new DomainError(ErrorCode.Unauthenticated, { module: 'iam' });
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (match === null) {
    throw new DomainError(ErrorCode.Unauthenticated, { module: 'iam' });
  }

  return match[1];
}

function malformed(): DomainError {
  return new DomainError(ErrorCode.MalformedRequest, { module: 'iam' });
}
