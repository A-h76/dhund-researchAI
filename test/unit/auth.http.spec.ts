import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { AuthController } from '../../src/iam/auth.controller';
import { AuthMetrics } from '../../src/iam/auth/auth.metrics';
import { AuthService } from '../../src/iam/auth/auth.service';
import { AuthTokensService } from '../../src/iam/auth/auth-tokens.service';
import { DUMMY_ARGON2_HASH } from '../../src/iam/password/dummy-hash';
import { PASSWORD_HASHER } from '../../src/iam/password/password-hasher';
import { RegistrationService } from '../../src/iam/registration/registration.service';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { ACCESS_TOKEN_ALGORITHMS } from '../../src/iam/tokens/access-token.constants';
import { hashRefreshToken } from '../../src/iam/tokens/refresh-token';
import { OUTBOX_SERVICE, SESSION_STORE } from '../../src/l0/ports';
import { APP_CONFIG } from '../../src/platform/config';
import { OutboxWriterService } from '../../src/platform/events';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import {
  correlationExpressMiddleware,
  PlatformLogger,
} from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { capturingOutbox } from '../fixtures/capturing-outbox';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemorySessionStore } from '../fixtures/memory-session-store';

const PASSWORD = 'http-login-pass12';
const STORED_HASH = '$argon2id$v=19$m=65536,t=3,p=4$stored';
const EMAIL = 'login-http@example.com';

async function startApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
  hasher: { verify: jest.Mock };
  store: MemorySessionStore;
  logs: unknown[];
  appended: ReturnType<typeof capturingOutbox>['appended'];
  userId: string;
  jwt: ReturnType<typeof generateTestJwtConfig>;
}> {
  const logs: unknown[] = [];
  const logger = {
    info: (fields: unknown) => logs.push(fields),
    warn: (fields: unknown) => logs.push(fields),
    error: (fields: unknown) => logs.push(fields),
    debug: (fields: unknown) => logs.push(fields),
  } as unknown as PlatformLogger;

  const jwt = generateTestJwtConfig();
  const config = installTestAppConfig({ jwt });
  const store = new MemorySessionStore();
  const userId = generateId();
  const orgId = generateId();
  store.seedUser(EMAIL, {
    userId,
    sessionVersion: 1,
    passwordHash: STORED_HASH,
    orgId,
    emailVerifiedAt: null,
  });

  const hasher = {
    hash: jest.fn(),
    verify: jest.fn(async (password: string, encodedHash: string) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return password === PASSWORD && encodedHash === STORED_HASH;
    }),
  };

  const { outbox, appended } = capturingOutbox();

  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      AuthService,
      AuthMetrics,
      AccessTokenService,
      OutboxWriterService,
      { provide: RegistrationService, useValue: { register: async () => undefined } },
      {
        provide: AuthTokensService,
        useValue: {
          afterRegister: async () => undefined,
          verifyEmail: async () => undefined,
          resendVerification: async () => ({ status: 'accepted' }),
          requestPasswordReset: async () => ({ status: 'accepted' }),
          resetPassword: async () => undefined,
        },
      },
      { provide: APP_CONFIG, useValue: config },
      { provide: PASSWORD_HASHER, useValue: hasher },
      { provide: SESSION_STORE, useValue: store },
      { provide: OUTBOX_SERVICE, useValue: outbox },
      { provide: PlatformLogger, useValue: logger },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(correlationExpressMiddleware);
  await app.init();
  await app.listen(0, '127.0.0.1');
  return {
    app,
    baseUrl: await app.getUrl(),
    hasher,
    store,
    logs,
    appended,
    userId,
    jwt,
  };
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; raw: string; json: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_ID_HEADER]: 'cor-auth-http',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  return {
    status: response.status,
    raw,
    json: raw.length === 0 ? null : (JSON.parse(raw) as unknown),
  };
}

describe('DHB-33 auth HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let hasher: { verify: jest.Mock };
  let store: MemorySessionStore;
  let logs: unknown[];
  let appended: ReturnType<typeof capturingOutbox>['appended'];
  let jwt: ReturnType<typeof generateTestJwtConfig>;

  beforeAll(async () => {
    const started = await startApp();
    app = started.app;
    baseUrl = started.baseUrl;
    hasher = started.hasher;
    store = started.store;
    logs = started.logs;
    appended = started.appended;
    jwt = started.jwt;
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in and returns only the token pair', async () => {
    const result = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 900,
      tokenType: 'Bearer',
    });
    const body = result.json as {
      accessToken: string;
      refreshToken: string;
    };
    expect(Object.keys(body as object).sort()).toEqual(
      ['accessToken', 'expiresIn', 'refreshToken', 'tokenType'].sort(),
    );
    expect(result.raw).not.toContain(PASSWORD);
    expect(result.raw).not.toContain(STORED_HASH);
    expect(JSON.stringify(logs)).not.toContain(PASSWORD);
    expect(JSON.stringify(logs)).not.toContain(body.refreshToken);
    expect(JSON.stringify(logs)).not.toContain(body.accessToken);
    expect(JSON.stringify(appended)).not.toContain(PASSWORD);
    expect(JSON.stringify(appended)).not.toContain(body.refreshToken);
  });

  it('returns byte-identical 401 bodies for unknown email vs wrong password', async () => {
    hasher.verify.mockClear();
    const unknownStarted = Date.now();
    const unknown = await postJson(
      baseUrl,
      '/v1/auth/login',
      { email: 'missing@example.com', password: PASSWORD },
      { [CORRELATION_ID_HEADER]: 'cor-enum' },
    );
    const unknownMs = Date.now() - unknownStarted;
    const wrongStarted = Date.now();
    const wrong = await postJson(
      baseUrl,
      '/v1/auth/login',
      { email: EMAIL, password: 'wrong-password-12' },
      { [CORRELATION_ID_HEADER]: 'cor-enum' },
    );
    const wrongMs = Date.now() - wrongStarted;

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(unknown.status);
    expect(wrong.raw).toBe(unknown.raw);
    expect(unknown.json).toMatchObject({
      code: ErrorCode.InvalidCredentials,
      message: 'Authentication required.',
    });
    expect(hasher.verify.mock.calls[0][1]).toBe(DUMMY_ARGON2_HASH);
    expect(hasher.verify.mock.calls[1][1]).toBe(STORED_HASH);
    expect(JSON.stringify(unknown.json)).not.toContain('missing@example.com');
    expect(JSON.stringify(wrong.json)).not.toContain(EMAIL);
    expect(hasher.verify).toHaveBeenCalledTimes(2);
    expect(Math.abs(unknownMs - wrongMs)).toBeLessThan(80);
  });

  it('publishes JWKS that verifies issued access tokens and omits the private key', async () => {
    const login = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    const accessToken = (login.json as { accessToken: string }).accessToken;
    const response = await fetch(`${baseUrl}/v1/auth/jwks`);
    const jwks = (await response.json()) as {
      keys: Array<{ kty: string; crv: string; x: string; kid: string; alg: string; d?: string }>;
    };
    expect(response.status).toBe(200);
    expect(jwks.keys[0]).toMatchObject({
      kty: 'OKP',
      crv: 'Ed25519',
      kid: jwt.kid,
      alg: 'EdDSA',
    });
    expect(jwks.keys[0].d).toBeUndefined();
    expect(JSON.stringify(jwks)).not.toContain('BEGIN PRIVATE KEY');
    const header = decodeProtectedHeader(accessToken);
    expect(header.kid).toBe(jwt.kid);
    expect(header.alg).toBe('EdDSA');
    const key = await importJWK(
      {
        kty: 'OKP',
        crv: 'Ed25519',
        x: jwks.keys[0].x,
        alg: 'EdDSA',
      },
      'EdDSA',
    );
    await expect(
      jwtVerify(accessToken, key, { algorithms: [...ACCESS_TOKEN_ALGORITHMS] }),
    ).resolves.toBeTruthy();
  });

  it('rotates refresh tokens and treats replay as reuse', async () => {
    const login = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    const first = login.json as { refreshToken: string; accessToken: string };
    const rotated = await postJson(baseUrl, '/v1/auth/refresh', {
      refreshToken: first.refreshToken,
    });
    expect(rotated.status).toBe(200);
    const next = rotated.json as { refreshToken: string };
    expect(next.refreshToken).not.toBe(first.refreshToken);
    const family = [...store.families.values()].find(
      (row) => row.currentTokenHash === hashRefreshToken(next.refreshToken),
    );
    expect(family).toBeDefined();
    expect(family?.currentTokenHash).not.toBe(first.refreshToken);

    const replay = await postJson(baseUrl, '/v1/auth/refresh', {
      refreshToken: first.refreshToken,
    });
    expect(replay.status).toBe(401);
    expect(replay.json).toMatchObject({ code: ErrorCode.RefreshReuseDetected });
    expect(replay.raw).not.toContain(first.refreshToken);

    const malformed = await postJson(baseUrl, '/v1/auth/refresh', {
      refreshToken: 'nope',
    });
    const unknown = await postJson(baseUrl, '/v1/auth/refresh', {
      refreshToken: `${generateId()}.secret`,
    });
    expect(malformed.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(malformed.json).toMatchObject({ code: ErrorCode.RefreshInvalid });
    expect(unknown.raw).toBe(malformed.raw);
  });

  it('requires a bearer token for logout-all and returns 204 with an empty body', async () => {
    const login = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    const tokens = login.json as { accessToken: string; refreshToken: string };
    const missing = await postJson(baseUrl, '/v1/auth/logout-all', {});
    expect(missing.status).toBe(401);
    expect(missing.json).toMatchObject({ code: ErrorCode.Unauthenticated });

    const result = await postJson(
      baseUrl,
      '/v1/auth/logout-all',
      {},
      { authorization: `Bearer ${tokens.accessToken}` },
    );
    expect(result.status).toBe(204);
    expect(result.raw).toBe('');

    const staleAccess = await postJson(
      baseUrl,
      '/v1/auth/logout-all',
      {},
      { authorization: `Bearer ${tokens.accessToken}` },
    );
    expect(staleAccess.status).toBe(401);
    const staleRefresh = await postJson(baseUrl, '/v1/auth/refresh', {
      refreshToken: tokens.refreshToken,
    });
    expect(staleRefresh.status).toBe(401);
    expect(JSON.stringify(logs)).not.toContain(tokens.accessToken);
    expect(JSON.stringify(logs)).not.toContain('Bearer ');
  });
});
