import { randomBytes } from 'node:crypto';
import { unwrapTotpSecret, wrapTotpSecret } from '../../src/iam/mfa/totp-wrap';
import { totpWrapKeyBytes } from '../fixtures/totp-wrap.fixture';

describe('TOTP wrap', () => {
  it('round-trips a secret and rejects a truncated blob', () => {
    const key = totpWrapKeyBytes();
    const secret = randomBytes(20);
    const wrapped = wrapTotpSecret(secret, key);
    expect(Buffer.from(unwrapTotpSecret(wrapped, key))).toEqual(secret);
    expect(() => unwrapTotpSecret(wrapped.slice(0, 10), key)).toThrow();
    expect(() => unwrapTotpSecret(wrapped, totpWrapKeyBytes())).toThrow();
  });
});
