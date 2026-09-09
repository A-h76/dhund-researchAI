import { DomainError } from '../../platform/errors/domain-error';
import { ErrorCode } from '../../platform/errors/error-codes';

export interface ParsedRegisterRequest {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
  readonly storedDisplayName: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRegisterRequest(body: unknown): ParsedRegisterRequest {
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

  let displayName: string | undefined;
  if (record.displayName !== undefined) {
    if (typeof record.displayName !== 'string') {
      throw malformed();
    }
    const trimmed = record.displayName.trim();
    if (trimmed.length > 0) {
      displayName = trimmed;
    }
  }

  const localPart = email.split('@')[0] ?? '';
  const storedDisplayName = displayName ?? (localPart.length > 0 ? localPart : 'User');

  return {
    email,
    password: record.password,
    ...(displayName !== undefined ? { displayName } : {}),
    storedDisplayName,
  };
}

function malformed(): DomainError {
  return new DomainError(ErrorCode.MalformedRequest, { module: 'iam' });
}
