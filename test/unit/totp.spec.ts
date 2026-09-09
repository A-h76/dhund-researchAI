import { randomBytes } from 'node:crypto';
import {
  decodeBase32,
  encodeBase32,
  generateTotp,
  verifyTotp,
} from '../../src/iam/mfa/totp';

describe('TOTP', () => {
  const secret = randomBytes(20);

  it('round-trips base32 and verifies the current window', () => {
    const encoded = encodeBase32(secret);
    const decoded = decodeBase32(encoded);
    expect(Buffer.from(decoded)).toEqual(Buffer.from(secret));
    const code = generateTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(decoded, code)).toBe(true);
  });

  it('accepts adjacent windows and rejects a far code', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const previous = generateTotp(secret, now - 30_000);
    const next = generateTotp(secret, now + 30_000);
    const far = generateTotp(secret, now + 120_000);
    expect(verifyTotp(secret, previous, now)).toBe(true);
    expect(verifyTotp(secret, next, now)).toBe(true);
    expect(verifyTotp(secret, far, now)).toBe(false);
    expect(verifyTotp(secret, '000000', now)).toBe(false);
  });
});
