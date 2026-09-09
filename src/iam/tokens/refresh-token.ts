import { createHash, randomBytes } from 'node:crypto';
import { isUuid } from '../../platform/ids/uuid-v7';

export function generateRefreshSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function formatRefreshToken(familyId: string, secret: string): string {
  return `${familyId}.${secret}`;
}

export function parseRefreshToken(
  token: string,
): { familyId: string; secret: string } | undefined {
  const separator = token.indexOf('.');
  if (separator <= 0 || token.indexOf('.', separator + 1) !== -1) {
    return undefined;
  }

  const familyId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!isUuid(familyId) || secret.length === 0) {
    return undefined;
  }

  return { familyId, secret };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
