import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AuthController } from '../../src/iam/auth.controller';
import { AuthService } from '../../src/iam/auth/auth.service';
import { AuthTokensService } from '../../src/iam/auth/auth-tokens.service';
import { stubMfaServiceProvider } from '../fixtures/stub-mfa-service';
import { accessAuthGuardProviders } from '../fixtures/access-auth-providers';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { PASSWORD_BREACH_LIST } from '../../src/iam/password/breach-list.port';
import { PASSWORD_HASHER } from '../../src/iam/password/password-hasher';
import { PasswordPolicy } from '../../src/iam/password/password-policy';
import { RegistrationMetrics } from '../../src/iam/registration/registration.metrics';
import { RegistrationService } from '../../src/iam/registration/registration.service';
import {
  OUTBOX_SERVICE,
  REGISTRATION_STORE,
  RegistrationConflictError,
  type OutboxPort,
} from '../../src/l0/ports';
import { OutboxWriterService } from '../../src/platform/events';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import {
  correlationExpressMiddleware,
  PlatformLogger,
} from '../../src/platform/logging';

const PASSWORD = 'http-register-12';

async function startApp(conflictEmails: Set<string> = new Set()): Promise<{
  app: INestApplication;
  baseUrl: string;
  hasher: { hash: jest.Mock };
  logs: unknown[];
}> {
  const logs: unknown[] = [];
  const logger = {
    info: (fields: unknown) => logs.push(fields),
    warn: (fields: unknown) => logs.push(fields),
    error: (fields: unknown) => logs.push(fields),
    debug: (fields: unknown) => logs.push(fields),
  } as unknown as PlatformLogger;

  const hasher = {
      hash: jest.fn(async () => '$argon2id$v=19$m=65536,t=3,p=4$abc'),
      verify: jest.fn(async () => false),
  };
  const store = {
    insert: jest.fn(async (_tx: unknown, records: { user: { email: string } }) => {
      if (conflictEmails.has(records.user.email.toLowerCase())) {
        throw new RegistrationConflictError();
      }
      conflictEmails.add(records.user.email.toLowerCase());
    }),
  };
  const outbox: OutboxPort = {
    withTransaction: async (work) => work({} as never),
    append: async () => undefined,
    appendStateMarker: async () => undefined,
    listUnrelayedOrdered: async () => [],
    markRelayed: async () => undefined,
    incrementAttempt: async () => undefined,
    countUnrelayed: async () => 0,
    oldestUnrelayedCreatedAt: async () => null,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      RegistrationService,
      PasswordPolicy,
      RegistrationMetrics,
      { provide: AuthService, useValue: { login: async () => undefined } },
      stubMfaServiceProvider,
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
      { provide: PASSWORD_HASHER, useValue: hasher },
      { provide: PASSWORD_BREACH_LIST, useValue: { check: async () => 'clear' } },
      { provide: REGISTRATION_STORE, useValue: store },
      { provide: OUTBOX_SERVICE, useValue: outbox },
      OutboxWriterService,
      { provide: PlatformLogger, useValue: logger },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ...accessAuthGuardProviders(),
      {
        provide: AccessTokenService,
        useValue: { verify: async () => ({ sub: '', sid: '', sv: 1, jti: '' }) },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(correlationExpressMiddleware);
  await app.init();
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: await app.getUrl(), hasher, logs };
}

async function postRegister(
  baseUrl: string,
  body: unknown,
): Promise<{ status: number; raw: string; json: unknown }> {
  const response = await fetch(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_ID_HEADER]: 'cor-register-http',
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  return { status: response.status, raw, json: JSON.parse(raw) as unknown };
}

describe('POST /v1/auth/register (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let hasher: { hash: jest.Mock };
  let logs: unknown[];

  beforeAll(async () => {
    const started = await startApp();
    app = started.app;
    baseUrl = started.baseUrl;
    hasher = started.hasher;
    logs = started.logs;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns identical 201 bodies for new and existing emails and hashes both', async () => {
    const created = await postRegister(baseUrl, {
      email: 'same-body@example.com',
      password: PASSWORD,
    });
    const duplicate = await postRegister(baseUrl, {
      email: 'same-body@example.com',
      password: PASSWORD,
    });

    expect(created.status).toBe(201);
    expect(duplicate.status).toBe(created.status);
    expect(duplicate.raw).toBe(created.raw);
    expect(created.json).toEqual({ status: 'pending_verification' });
    expect(hasher.hash).toHaveBeenCalledTimes(2);
    expect(created.raw).not.toContain(PASSWORD);
    expect(JSON.stringify(logs)).not.toContain(PASSWORD);
  });

  it('rejects an 11-character password with min_length and does not hash', async () => {
    hasher.hash.mockClear();
    const result = await postRegister(baseUrl, {
      email: 'short@example.com',
      password: 'abcdefghijk',
    });

    expect(result.status).toBe(422);
    expect(result.json).toMatchObject({
      code: ErrorCode.ValidationError,
      details: { fields: [{ field: 'password', rule: 'min_length', min: 12 }] },
    });
    expect(result.raw).not.toContain('abcdefghijk');
    expect(hasher.hash).not.toHaveBeenCalled();
  });

  it('returns malformed_request for a non-string email', async () => {
    const result = await postRegister(baseUrl, {
      email: 12,
      password: PASSWORD,
    });
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: ErrorCode.MalformedRequest });
  });

  it('never returns email_taken', async () => {
    const created = await postRegister(baseUrl, {
      email: 'taken-check@example.com',
      password: PASSWORD,
    });
    const duplicate = await postRegister(baseUrl, {
      email: 'taken-check@example.com',
      password: PASSWORD,
    });
    expect(JSON.stringify(created.json)).not.toContain('email_taken');
    expect(JSON.stringify(duplicate.json)).not.toContain('email_taken');
  });
});
