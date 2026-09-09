import { createHmac } from 'node:crypto';
import { generateKeyPair, importPKCS8, SignJWT } from 'jose';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { AuthTokenService } from '../../src/iam/tokens/auth-token.service';
import { MfaChallengeService } from '../../src/iam/tokens/mfa-challenge.service';
import { DomainError } from '../../src/platform/errors/domain-error';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemorySessionStore } from '../fixtures/memory-session-store';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$abc';

function base64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input) : input).toString('base64url');
}

describe('AccessTokenService (GAP-JWT-01)', () => {
  const jwt = generateTestJwtConfig();
  const userId = generateId();
  const sessionId = generateId();
  const orgId = generateId();
  let store: MemorySessionStore;
  let tokens: AccessTokenService;

  beforeEach(() => {
    store = new MemorySessionStore();
    store.seedUser('user@example.com', {
      userId,
      sessionVersion: 1,
      passwordHash: PASSWORD_HASH,
      orgId,
      emailVerifiedAt: null,
    });
    store.sessions.set(sessionId, {
      sessionId,
      userId,
      revokedAt: null,
      userSessionVersion: 1,
    });
    const config = installTestAppConfig({ jwt });
    tokens = new AccessTokenService(config, store);
  });

  async function issued(): Promise<string> {
    return tokens.sign({ sub: userId, sid: sessionId, sv: 1 });
  }

  it('accepts a valid Ed25519 token with the configured kid and claims', async () => {
    const token = await issued();
    const verified = await tokens.verify(token);
    expect(verified).toMatchObject({ sub: userId, sid: sessionId, sv: 1 });
    expect(typeof verified.jti).toBe('string');

    const jwks = await tokens.jwks();
    expect(jwks.keys).toEqual([
      expect.objectContaining({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: jwt.kid,
        alg: 'EdDSA',
      }),
    ]);
    expect(jwks.keys[0]).not.toHaveProperty('d');
    expect(JSON.stringify(jwks)).not.toContain(jwt.privateKey);
  });

  it('rejects alg none', async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: jwt.kid }));
    const payload = base64url(
      JSON.stringify({
        sub: userId,
        sid: sessionId,
        sv: 1,
        jti: generateId(),
        iat: now,
        exp: now + 900,
      }),
    );
    await expect(tokens.verify(`${header}.${payload}.`)).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects HS256 HMAC using the Ed25519 public key as the secret', async () => {
    const jwks = await tokens.jwks();
    const secret = Buffer.from(jwks.keys[0].x, 'base64url');
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(
      JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: jwt.kid }),
    );
    const payload = base64url(
      JSON.stringify({
        sub: userId,
        sid: sessionId,
        sv: 1,
        jti: generateId(),
        iat: now,
        exp: now + 900,
      }),
    );
    const signature = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest();
    const forged = `${header}.${payload}.${base64url(signature)}`;

    await expect(tokens.verify(forged)).rejects.toBeInstanceOf(DomainError);
    await expect(tokens.verify(forged)).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects ES256 / P-256 tokens', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const token = await new SignJWT({ sid: sessionId, sv: 1 })
      .setProtectedHeader({ alg: 'ES256', kid: jwt.kid, typ: 'JWT' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('15m')
      .setJti(generateId())
      .sign(privateKey);

    await expect(tokens.verify(token)).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects a bad signature', async () => {
    const token = await issued();
    const tampered = `${token.slice(0, -4)}abcd`;
    await expect(tokens.verify(tampered)).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects an expired token', async () => {
    const privateKey = await importPKCS8(jwt.privateKey, 'EdDSA');
    const token = await new SignJWT({ sid: sessionId, sv: 1 })
      .setProtectedHeader({ alg: 'EdDSA', kid: jwt.kid, typ: 'JWT' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(0)
      .setJti(generateId())
      .sign(privateKey);

    await expect(tokens.verify(token)).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects a wrong kid', async () => {
    const privateKey = await importPKCS8(jwt.privateKey, 'EdDSA');
    const token = await new SignJWT({ sid: sessionId, sv: 1 })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'other-kid', typ: 'JWT' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('15m')
      .setJti(generateId())
      .sign(privateKey);

    await expect(tokens.verify(token)).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects a token when sessionVersion does not match the user', async () => {
    const token = await issued();
    store.sessions.set(sessionId, {
      sessionId,
      userId,
      revokedAt: null,
      userSessionVersion: 2,
    });
    await expect(tokens.verify(token)).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects a revoked session', async () => {
    const token = await issued();
    store.sessions.set(sessionId, {
      sessionId,
      userId,
      revokedAt: new Date(),
      userSessionVersion: 1,
    });
    await expect(tokens.verify(token)).rejects.toMatchObject({
      code: ErrorCode.SessionRevoked,
    });
  });

  it('E7: membership revocation is not consulted during access-token verify', async () => {
    const token = await issued();
    await expect(tokens.verify(token)).resolves.toMatchObject({
      sub: userId,
      sid: sessionId,
      sv: 1,
    });
    expect(store.getAccessSession).toBeDefined();
  });

  it('rejects an auth-token JWS at the access-token verifier', async () => {
    const authTokens = new AuthTokenService(installTestAppConfig({ jwt }));
    const authToken = await authTokens.sign({
      sub: userId,
      purpose: 'email_verification',
      jti: generateId(),
      ttlSeconds: 3600,
    });
    await expect(tokens.verify(authToken)).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects an MFA challenge JWS at the access-token verifier', async () => {
    const challenges = new MfaChallengeService(installTestAppConfig({ jwt }));
    const challenge = await challenges.sign(userId);
    await expect(tokens.verify(challenge)).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });
});
