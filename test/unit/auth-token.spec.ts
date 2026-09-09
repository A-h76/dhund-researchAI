import { importPKCS8, SignJWT } from 'jose';
import { AUTH_TOKEN_TYP } from '../../src/iam/tokens/auth-token.constants';
import { AuthTokenService } from '../../src/iam/tokens/auth-token.service';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemorySessionStore } from '../fixtures/memory-session-store';

describe('AuthTokenService', () => {
  const jwt = generateTestJwtConfig();
  const config = installTestAppConfig({ jwt });
  const service = new AuthTokenService(config);
  const userId = generateId();
  const jti = generateId();

  it('round-trips an email verification token without session claims', async () => {
    const token = await service.sign({
      sub: userId,
      purpose: 'email_verification',
      jti,
      ttlSeconds: 3600,
    });
    const verified = await service.verify(token, 'email_verification');
    expect(verified).toEqual({
      sub: userId,
      purpose: 'email_verification',
      jti,
    });
    expect(token.split('.').length).toBe(3);
  });

  it('rejects a token presented for the wrong purpose', async () => {
    const token = await service.sign({
      sub: userId,
      purpose: 'email_verification',
      jti: generateId(),
      ttlSeconds: 3600,
    });
    await expect(service.verify(token, 'password_reset')).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects an access JWT', async () => {
    const store = new MemorySessionStore();
    const access = new AccessTokenService(config, store);
    const accessToken = await access.sign({
      sub: userId,
      sid: generateId(),
      sv: 1,
    });
    await expect(
      service.verify(accessToken, 'email_verification'),
    ).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
  });

  it('rejects a JWT with the access typ', async () => {
    const privateKey = await importPKCS8(jwt.privateKey, 'EdDSA');
    const forged = await new SignJWT({ purpose: 'email_verification' })
      .setProtectedHeader({ alg: 'EdDSA', kid: jwt.kid, typ: 'JWT' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .setJti(generateId())
      .sign(privateKey);

    await expect(
      service.verify(forged, 'email_verification'),
    ).rejects.toMatchObject({
      code: ErrorCode.TokenInvalid,
    });
    expect(AUTH_TOKEN_TYP).toBe('dn-at+jwt');
  });
});
