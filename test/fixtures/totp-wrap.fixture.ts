import { randomBytes } from 'node:crypto';

export function generateTestTotpWrapKey(): string {
  return randomBytes(32).toString('base64');
}

export function totpWrapKeyBytes(raw = generateTestTotpWrapKey()): Uint8Array {
  return new Uint8Array(Buffer.from(raw, 'base64'));
}
