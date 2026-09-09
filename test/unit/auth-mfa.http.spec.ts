import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { decodeProtectedHeader } from 'jose';
import { AuthController } from '../../src/iam/auth.controller';
import { AuthMetrics } from '../../src/iam/auth/auth.metrics';
import { AuthService } from '../../src/iam/auth/auth.service';
import { AuthTokensService } from '../../src/iam/auth/auth-tokens.service';
import { MfaMetrics } from '../../src/iam/auth/mfa.metrics';
import { MfaService } from '../../src/iam/auth/mfa.service';
import { DUMMY_ARGON2_HASH } from '../../src/iam/password/dummy-hash';
import { PASSWORD_HASHER } from '../../src/iam/password/password-hasher';
import { RegistrationService } from '../../src/iam/registration/registration.service';
import { decodeBase32, generateTotp } from '../../src/iam/mfa/totp';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { MfaChallengeService } from '../../src/iam/tokens/mfa-challenge.service';
import { MFA_CHALLENGE_TYP } from '../../src/iam/tokens/mfa-challenge.constants';
import {
  MFA_STORE,
  OUTBOX_SERVICE,
  SESSION_STORE,
} from '../../src/l0/ports';
import { APP_CONFIG } from '../../src/platform/config';
import { OutboxWriterService } from '../../src/platform/events';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  REFRESH_COOKIE_NAME,
  csrfExpressMiddleware,
} from '../../src/platform/http';
import {
  correlationExpressMiddleware,
  PlatformLogger,
} from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { capturingOutbox } from '../fixtures/capturing-outbox';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemoryMfaStore } from '../fixtures/memory-mfa-store';
import { MemorySessionStore } from '../fixtures/memory-session-store';

const PASSWORD = 'http-mfa-pass-12';
const STORED_HASH = '$argon2id$v=19$m=65536,t=3,p=4$stored';
const EMAIL = 'mfa-http@example.com';

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const raw = response.headers.get('set-cookie');
  return raw === null ? [] : [raw];
}

function cookieValue(headers: string[], name: string): string | undefined {
  const line = headers.find((header) => header.startsWith(`${name}=`));
  if (line === undefined) {
    return undefined;
  }
  return line.slice(name.length + 1).split(';')[0];
}

async function startApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
  store: MemorySessionStore;
  mfa: MemoryMfaStore;
  logs: unknown[];
  userId: string;
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
  const mfa = new MemoryMfaStore(store);
  const userId = generateId();
  const orgId = generateId();
  store.seedUser(EMAIL, {
    userId,
    sessionVersion: 1,
    passwordHash: STORED_HASH,
    orgId,
    emailVerifiedAt: null,
    privileged: true,
  });

  const hasher = {
    hash: jest.fn(),
    verify: jest.fn(async (password: string, encodedHash: string) => {
      return password === PASSWORD && encodedHash === STORED_HASH;
    }),
  };
  const { outbox } = capturingOutbox();

  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      AuthService,
      AuthMetrics,
      MfaMetrics,
      MfaChallengeService,
      MfaService,
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
      { provide: MFA_STORE, useValue: mfa },
      { provide: OUTBOX_SERVICE, useValue: outbox },
      { provide: PlatformLogger, useValue: logger },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(correlationExpressMiddleware);
  app.use(csrfExpressMiddleware);
  await app.init();
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: await app.getUrl(), store, mfa, logs, userId };
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; raw: string; json: unknown; cookies: string[] }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_ID_HEADER]: 'cor-mfa-http',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  return {
    status: response.status,
    raw,
    json: raw.length === 0 ? null : (JSON.parse(raw) as unknown),
    cookies: setCookies(response),
  };
}

describe('DHB-35 MFA cookies CSRF HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let store: MemorySessionStore;
  let logs: unknown[];
  let userId: string;

  beforeAll(async () => {
    const started = await startApp();
    app = started.app;
    baseUrl = started.baseUrl;
    store = started.store;
    logs = started.logs;
    userId = started.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets distinguishable cookies on first-login without MFA', async () => {
    const result = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(result.status).toBe(200);
    const refresh = result.cookies.find((row) => row.startsWith(`${REFRESH_COOKIE_NAME}=`));
    const csrf = result.cookies.find((row) => row.startsWith(`${CSRF_COOKIE_NAME}=`));
    expect(refresh).toBeDefined();
    expect(csrf).toBeDefined();
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('Secure');
    expect(refresh).toContain('SameSite=Lax');
    expect(refresh).toContain('Path=/v1/auth');
    expect(csrf).not.toContain('HttpOnly');
    expect(csrf).toContain('Secure');
    expect(csrf).toContain('SameSite=Lax');
    expect(csrf).toContain('Path=/');
    const body = result.json as { refreshToken: string };
    expect(body.refreshToken).toBeTruthy();
  });

  it('challenges enrolled MFA, then issues a session after TOTP verify', async () => {
    const login = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    const accessToken = (login.json as { accessToken: string }).accessToken;
    const enrol = await postJson(
      baseUrl,
      '/v1/auth/mfa/totp/enrol',
      {},
      { authorization: `Bearer ${accessToken}` },
    );
    expect(enrol.status).toBe(200);
    const enrolled = enrol.json as { secret: string; otpauthUrl: string };
    expect(enrolled.otpauthUrl).toContain(enrolled.secret);
    const code = generateTotp(decodeBase32(enrolled.secret));
    const confirm = await postJson(
      baseUrl,
      '/v1/auth/mfa/totp/confirm',
      { code },
      { authorization: `Bearer ${accessToken}` },
    );
    expect(confirm.status).toBe(200);
    const recoveryCodes = (confirm.json as { recoveryCodes: string[] }).recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);

    const beforeChallenge = store.sessions.size;
    const challenged = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(challenged.status).toBe(401);
    expect(challenged.json).toMatchObject({
      code: ErrorCode.MfaRequired,
      message: 'Multi-factor authentication required.',
      details: { challengeToken: expect.any(String) },
    });
    expect(store.sessions.size).toBe(beforeChallenge);
    const challengeToken = (challenged.json as { details: { challengeToken: string } })
      .details.challengeToken;
    expect(decodeProtectedHeader(challengeToken).typ).toBe(MFA_CHALLENGE_TYP);
    expect(JSON.stringify(logs)).not.toContain(challengeToken);
    expect(JSON.stringify(challenged.json)).not.toContain(PASSWORD);

    const verifyCode = generateTotp(decodeBase32(enrolled.secret));
    const verified = await postJson(baseUrl, '/v1/auth/mfa/verify', {
      challengeToken,
      code: verifyCode,
    });
    expect(verified.status).toBe(200);
    expect(verified.json).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 900,
      tokenType: 'Bearer',
    });
    expect(verified.cookies.some((row) => row.startsWith(`${REFRESH_COOKIE_NAME}=`))).toBe(
      true,
    );
    expect(store.sessions.size).toBe(beforeChallenge + 1);

    const challengedAgain = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    const recoveryChallenge = (
      challengedAgain.json as { details: { challengeToken: string } }
    ).details.challengeToken;
    const recovered = await postJson(baseUrl, '/v1/auth/mfa/verify', {
      challengeToken: recoveryChallenge,
      recoveryCode: recoveryCodes[0],
    });
    expect(recovered.status).toBe(200);

    const replayChallenge = (
      (
        await postJson(baseUrl, '/v1/auth/login', {
          email: EMAIL,
          password: PASSWORD,
        })
      ).json as { details: { challengeToken: string } }
    ).details.challengeToken;
    const spent = await postJson(baseUrl, '/v1/auth/mfa/verify', {
      challengeToken: replayChallenge,
      recoveryCode: recoveryCodes[0],
    });
    const unknown = await postJson(baseUrl, '/v1/auth/mfa/verify', {
      challengeToken: replayChallenge,
      recoveryCode: 'FFFF-FFFF-FFFF-FFFF',
    });
    expect(spent.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(spent.raw).toBe(unknown.raw);
    expect(spent.json).toMatchObject({ code: ErrorCode.MfaRecoveryInvalid });
  });

  it('requires CSRF for cookie refresh and lets Bearer bypass it', async () => {
    store.setMfaEnabled(userId, false);
    const login = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    const refreshCookie = cookieValue(login.cookies, REFRESH_COOKIE_NAME);
    const csrfCookie = cookieValue(login.cookies, CSRF_COOKIE_NAME);
    expect(refreshCookie).toBeTruthy();
    expect(csrfCookie).toBeTruthy();
    const cookieHeader = `${REFRESH_COOKIE_NAME}=${refreshCookie}; ${CSRF_COOKIE_NAME}=${csrfCookie}`;

    const missing = await postJson(
      baseUrl,
      '/v1/auth/refresh',
      {},
      { cookie: cookieHeader },
    );
    expect(missing.status).toBe(403);
    expect(missing.json).toMatchObject({ code: ErrorCode.CsrfInvalid });

    const ok = await postJson(
      baseUrl,
      '/v1/auth/refresh',
      {},
      { cookie: cookieHeader, [CSRF_HEADER_NAME]: csrfCookie! },
    );
    expect(ok.status).toBe(200);

    const jsonCompat = await postJson(baseUrl, '/v1/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    const pair = jsonCompat.json as { accessToken: string; refreshToken: string };
    const rotated = await postJson(baseUrl, '/v1/auth/refresh', {
      refreshToken: pair.refreshToken,
    });
    expect(rotated.status).toBe(200);

    const withCookies = await postJson(
      baseUrl,
      '/v1/auth/logout-all',
      {},
      {
        authorization: `Bearer ${pair.accessToken}`,
        cookie: `${REFRESH_COOKIE_NAME}=stale; ${CSRF_COOKIE_NAME}=stale`,
      },
    );
    expect(withCookies.status).toBe(204);
    expect(withCookies.raw).toBe('');
  });

  it('does not treat the dummy hash path as MFA', async () => {
    const result = await postJson(baseUrl, '/v1/auth/login', {
      email: 'missing-mfa@example.com',
      password: PASSWORD,
    });
    expect(result.status).toBe(401);
    expect(result.json).toMatchObject({ code: ErrorCode.InvalidCredentials });
    expect(DUMMY_ARGON2_HASH.length).toBeGreaterThan(0);
  });
});
