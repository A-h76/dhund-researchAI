import { createHash, randomBytes } from 'node:crypto';

export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const hex = randomBytes(8).toString('hex').toUpperCase();
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`);
  }
  return codes;
}

export function canonicalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(canonicalizeRecoveryCode(code), 'utf8').digest('hex');
}
