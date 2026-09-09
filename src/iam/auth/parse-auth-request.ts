import { DomainError } from '../../platform/errors/domain-error';
import { ErrorCode } from '../../platform/errors/error-codes';
import { readRefreshCookie } from '../../platform/http';

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
  return { refreshToken: parseRefreshCredential(body) };
}

export function parseRefreshCredential(
  body: unknown,
  cookieHeader?: string,
): string {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if ('refreshToken' in record) {
      if (typeof record.refreshToken !== 'string') {
        throw malformed();
      }
      return record.refreshToken;
    }
  } else if (body !== undefined && body !== null) {
    throw malformed();
  }

  const fromCookie = readRefreshCookie(cookieHeader);
  if (fromCookie === undefined) {
    throw new DomainError(ErrorCode.RefreshInvalid, { module: 'iam' });
  }
  return fromCookie;
}

export function parseTotpCodeRequest(body: unknown): { code: string } {
  const record = asObject(body);
  return { code: requiredCode(record.code) };
}

export function parseMfaFactorRequest(body: unknown): {
  code?: string;
  recoveryCode?: string;
} {
  const record = asObject(body);
  return exactlyOneFactor(record);
}

export function parseMfaVerifyRequest(body: unknown): {
  challengeToken: string;
  code?: string;
  recoveryCode?: string;
} {
  const record = asObject(body);
  if (typeof record.challengeToken !== 'string' || record.challengeToken.length === 0) {
    throw malformed();
  }
  const factor = exactlyOneFactor(record);
  return { challengeToken: record.challengeToken, ...factor };
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

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }
  return body as Record<string, unknown>;
}

function requiredCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value.replace(/\s/g, ''))) {
    throw malformed();
  }
  return value.replace(/\s/g, '');
}

function exactlyOneFactor(record: Record<string, unknown>): {
  code?: string;
  recoveryCode?: string;
} {
  const hasCode = record.code !== undefined;
  const hasRecovery = record.recoveryCode !== undefined;
  if (hasCode === hasRecovery) {
    throw malformed();
  }
  if (hasCode) {
    return { code: requiredCode(record.code) };
  }
  if (typeof record.recoveryCode !== 'string' || record.recoveryCode.trim().length === 0) {
    throw malformed();
  }
  return { recoveryCode: record.recoveryCode };
}

function malformed(): DomainError {
  return new DomainError(ErrorCode.MalformedRequest, { module: 'iam' });
}
