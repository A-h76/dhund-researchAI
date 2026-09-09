import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AuthController } from '../../src/iam/auth.controller';
import { AuthMetrics } from '../../src/iam/auth/auth.metrics';
import { AuthService } from '../../src/iam/auth/auth.service';
import { AuthTokenMetrics } from '../../src/iam/auth/auth-token.metrics';
import { AuthTokensService } from '../../src/iam/auth/auth-tokens.service';
import { MfaMetrics } from '../../src/iam/auth/mfa.metrics';
import { PASSWORD_BREACH_LIST } from '../../src/iam/password/breach-list.port';
import { PASSWORD_HASHER } from '../../src/iam/password/password-hasher';
import { PasswordPolicy } from '../../src/iam/password/password-policy';
import { RegistrationMetrics } from '../../src/iam/registration/registration.metrics';
import { RegistrationService } from '../../src/iam/registration/registration.service';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { AuthTokenService } from '../../src/iam/tokens/auth-token.service';
import { MfaChallengeService } from '../../src/iam/tokens/mfa-challenge.service';
import { hashAuthToken } from '../../src/iam/tokens/auth-token';
import {
  AUTH_TOKEN_STORE,
  EMAIL_SERVICE,
  OUTBOX_SERVICE,
  SESSION_STORE,
  type EmailSendParams,
} from '../../src/l0/ports';
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
import { MemoryAuthTokenStore } from '../fixtures/memory-auth-token-store';
import { MemorySessionStore } from '../fixtures/memory-session-store';
import { stubMfaServiceProvider } from '../fixtures/stub-mfa-service';

const PASSWORD = 'http-reset-pass12';
const STORED_HASH = '$argon2id$v=19$m=65536,t=3,p=4$stored';
const EMAIL = 'verify-http@example.com';

function tokenFromHtml(html: string): string {
  const match = /<p>([^<]+)<\/p>/.exec(html);
  if (match === null) {
    throw new Error('missing token html');
  }
  return match[1];
}

async function startApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
  sessions: MemorySessionStore;
  tokens: MemoryAuthTokenStore;
  sent: EmailSendParams[];
  logs: unknown[];
  hasher: { hash: jest.Mock };
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
  const sessions = new MemorySessionStore();
  const tokens = new MemoryAuthTokenStore();
  const userId = generateId();
  const orgId = generateId();
  sessions.seedUser(EMAIL, {
    userId,
    sessionVersion: 1,
    passwordHash: STORED_HASH,
    orgId,
    emailVerifiedAt: null,
  });
  tokens.seedUser(userId, {
    email: EMAIL,
    orgId,
    emailVerifiedAt: null,
    passwordHash: STORED_HASH,
  });

  const sent: EmailSendParams[] = [];
  const hasher = {
    hash: jest.fn(async () => '$argon2id$new'),
    verify: jest.fn(async () => false),
  };
  const { outbox } = capturingOutbox();

  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      AuthService,
      AuthMetrics,
      MfaMetrics,
      MfaChallengeService,
      AuthTokenMetrics,
      AccessTokenService,
      AuthTokenService,
      AuthTokensService,
      PasswordPolicy,
      RegistrationMetrics,
      OutboxWriterService,
      { provide: RegistrationService, useValue: { register: async () => undefined } },
      stubMfaServiceProvider,
      { provide: APP_CONFIG, useValue: config },
      { provide: PASSWORD_HASHER, useValue: hasher },
      { provide: PASSWORD_BREACH_LIST, useValue: { check: async () => 'clear' as const } },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: AUTH_TOKEN_STORE, useValue: tokens },
      { provide: EMAIL_SERVICE, useValue: { send: async (params: EmailSendParams) => {
        sent.push(params);
        return { id: 'msg-1' };
      } } },
      { provide: OUTBOX_SERVICE, useValue: outbox },
      { provide: PlatformLogger, useValue: logger },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(correlationExpressMiddleware);
  await app.init();
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: await app.getUrl(), sessions, tokens, sent, logs, hasher };
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
      [CORRELATION_ID_HEADER]: 'cor-verify-http',
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

describe('DHB-34 verify/reset HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: MemoryAuthTokenStore;
  let sent: EmailSendParams[];
  let logs: unknown[];
  let hasher: { hash: jest.Mock };

  beforeAll(async () => {
    const started = await startApp();
    app = started.app;
    baseUrl = started.baseUrl;
    tokens = started.tokens;
    sent = started.sent;
    logs = started.logs;
    hasher = started.hasher;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns identical 200 accepted bodies for known and unknown resend and reset-request', async () => {
    const resendKnown = await postJson(baseUrl, '/v1/auth/verify-email/resend', {
      email: EMAIL,
    });
    const resendUnknown = await postJson(baseUrl, '/v1/auth/verify-email/resend', {
      email: 'nobody@example.com',
    });
    const resetKnown = await postJson(baseUrl, '/v1/auth/password/reset-request', {
      email: EMAIL,
    });
    const resetUnknown = await postJson(baseUrl, '/v1/auth/password/reset-request', {
      email: 'nobody@example.com',
    });

    expect(resendKnown.status).toBe(200);
    expect(resendUnknown.status).toBe(200);
    expect(resendUnknown.raw).toBe(resendKnown.raw);
    expect(resendKnown.json).toEqual({ status: 'accepted' });
    expect(resetKnown.status).toBe(200);
    expect(resetUnknown.raw).toBe(resetKnown.raw);
    expect(resetKnown.json).toEqual({ status: 'accepted' });
    expect(sent.map((row) => row.to)).toEqual([EMAIL, EMAIL]);
  });

  it('verifies email with 204 and rejects a second redeem with the same 401 as unknown', async () => {
    sent.length = 0;
    await postJson(baseUrl, '/v1/auth/verify-email/resend', { email: EMAIL });
    const token = tokenFromHtml(sent[0].html);
    expect(tokens.tokens.has(token)).toBe(false);

    const first = await postJson(baseUrl, '/v1/auth/verify-email', { token });
    const second = await postJson(baseUrl, '/v1/auth/verify-email', { token });
    const unknown = await postJson(baseUrl, '/v1/auth/verify-email', {
      token: 'totally-unknown',
    });

    expect(first.status).toBe(204);
    expect(first.raw).toBe('');
    expect(second.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(second.raw).toBe(unknown.raw);
    expect(second.json).toMatchObject({
      code: ErrorCode.TokenInvalid,
      message: 'Authentication required.',
    });
    expect(JSON.stringify(second.json)).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain(hashAuthToken(token));
  });

  it('rejects a weak reset password without hashing or spending the token', async () => {
    sent.length = 0;
    hasher.hash.mockClear();
    await postJson(baseUrl, '/v1/auth/password/reset-request', { email: EMAIL });
    const token = tokenFromHtml(sent[0].html);
    const result = await postJson(baseUrl, '/v1/auth/password/reset', {
      token,
      password: 'short',
    });
    expect(result.status).toBe(422);
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(tokens.tokens.get(hashAuthToken(token))?.consumedAt).toBeNull();
    expect(result.raw).not.toContain('short');
    expect(result.raw).not.toContain(token);
  });

  it('resets a password with 204', async () => {
    sent.length = 0;
    await postJson(baseUrl, '/v1/auth/password/reset-request', { email: EMAIL });
    const token = tokenFromHtml(sent[0].html);
    const result = await postJson(baseUrl, '/v1/auth/password/reset', {
      token,
      password: PASSWORD,
    });
    expect(result.status).toBe(204);
    expect(result.raw).toBe('');
    expect(tokens.tokens.get(hashAuthToken(token))?.consumedAt).not.toBeNull();
  });
});
