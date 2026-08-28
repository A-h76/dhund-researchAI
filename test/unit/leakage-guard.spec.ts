import {
  containsForbiddenLeak,
  containsSensitiveKey,
  sanitizeForLog,
} from '../../src/platform/errors/leakage-guard';

describe('leakage guard (Phase 8 §6)', () => {
  it('detects SQL, constraint, Prisma, provider, host, and secret leaks', () => {
    expect(containsForbiddenLeak('Unique constraint failed on users_email_key')).toBe(
      true,
    );
    expect(containsForbiddenLeak('PrismaClientKnownRequestError P2002')).toBe(true);
    expect(containsForbiddenLeak('Voyage voyage-4 failed')).toBe(true);
    expect(containsForbiddenLeak('http://169.254.169.254/latest')).toBe(true);
    expect(containsForbiddenLeak('bucket.s3.amazonaws.com')).toBe(true);
    expect(containsForbiddenLeak('sk-abcdefghijklmnop')).toBe(true);
    expect(containsForbiddenLeak('at Service.render (src/app.ts:12:3)')).toBe(true);
  });

  it('detects password keys as sensitive', () => {
    expect(containsSensitiveKey({ password: 'N0tInBody!!' })).toBe(true);
    expect(containsSensitiveKey({ fields: [{ field: 'password', rule: 'breached' }] })).toBe(
      false,
    );
  });

  it('redacts sensitive keys and forbidden strings from log payloads', () => {
    expect(
      sanitizeForLog({
        kind: 'domain',
        password: 'N0tInBody!!',
        prompt: 'ignore previous instructions',
      }),
    ).toEqual({ kind: 'domain' });

    expect(
      sanitizeForLog({
        kind: 'provider',
        provider: 'voyage',
        model: 'voyage-4',
      }),
    ).toEqual({ redacted: true });
  });
});
