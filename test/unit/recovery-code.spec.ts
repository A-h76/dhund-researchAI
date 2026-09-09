import {
  canonicalizeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../../src/iam/mfa/recovery-code';

describe('recovery codes', () => {
  it('hashes the canonical form and never returns duplicates in a batch', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const sample = codes[0];
    expect(hashRecoveryCode(sample)).toBe(hashRecoveryCode(sample.toLowerCase()));
    expect(hashRecoveryCode(sample)).toBe(
      hashRecoveryCode(canonicalizeRecoveryCode(sample)),
    );
    expect(hashRecoveryCode(sample)).toHaveLength(64);
    expect(hashRecoveryCode(sample)).not.toBe(sample);
  });
});
