import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { AuthController } from '../../src/iam/auth.controller';
import { AuthMetrics } from '../../src/iam/auth/auth.metrics';
import { AuthService } from '../../src/iam/auth/auth.service';
import { AuthTokenMetrics } from '../../src/iam/auth/auth-token.metrics';
import { AuthTokensService } from '../../src/iam/auth/auth-tokens.service';
import { MfaMetrics } from '../../src/iam/auth/mfa.metrics';
import { Argon2PasswordHasher } from '../../src/iam/password/argon2-hasher';
import { PASSWORD_BREACH_LIST } from '../../src/iam/password/breach-list.port';
import { PASSWORD_HASHER } from '../../src/iam/password/password-hasher';
import { PasswordPolicy } from '../../src/iam/password/password-policy';
import { RegistrationMetrics } from '../../src/iam/registration/registration.metrics';
import { RegistrationService } from '../../src/iam/registration/registration.service';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { hashAuthToken } from '../../src/iam/tokens/auth-token';
import { AuthTokenService } from '../../src/iam/tokens/auth-token.service';
import { MfaChallengeService } from '../../src/iam/tokens/mfa-challenge.service';
import { PrismaAuthTokenAdapter } from '../../src/l0/adapters/prisma/prisma-auth-token.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaOutboxAdapter } from '../../src/l0/adapters/prisma/prisma-outbox.adapter';
import { PrismaRegistrationAdapter } from '../../src/l0/adapters/prisma/prisma-registration.adapter';
import { PrismaSessionAdapter } from '../../src/l0/adapters/prisma/prisma-session.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import type {
  AuthTokenStore,
  ConsumeOutcome,
  EmailSendParams,
  OutboxTransaction,
} from '../../src/l0/ports';
import {
  AUTH_TOKEN_STORE,
  EMAIL_SERVICE,
  OUTBOX_SERVICE,
  REGISTRATION_STORE,
  SESSION_STORE,
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
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { stubMfaServiceProvider } from '../fixtures/stub-mfa-service';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');
const PASSWORD = 'integration-pass-12';
const NEXT_PASSWORD = 'integration-next-12';

class InjectingAuthTokenStore implements AuthTokenStore {
  failAfterConsume = false;

  constructor(private readonly inner: AuthTokenStore) {}

  replaceOutstanding(
    tx: OutboxTransaction,
    record: Parameters<AuthTokenStore['replaceOutstanding']>[1],
  ): Promise<void> {
    return this.inner.replaceOutstanding(tx, record);
  }

  async consumeIfUnspent(
    tx: OutboxTransaction,
    input: Parameters<AuthTokenStore['consumeIfUnspent']>[1],
  ): Promise<ConsumeOutcome> {
    const result = await this.inner.consumeIfUnspent(tx, input);
    if (this.failAfterConsume && result.status === 'consumed') {
      throw new Error('injected-verify-failure');
    }
    return result;
  }

  markEmailVerified(
    tx: OutboxTransaction,
    userId: string,
    verifiedAt: Date,
  ): Promise<void> {
    return this.inner.markEmailVerified(tx, userId, verifiedAt);
  }

  updatePasswordHash(
    tx: OutboxTransaction,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    return this.inner.updatePasswordHash(tx, userId, passwordHash);
  }
}

function tokenFromHtml(html: string): string {
  const match = /<p>([^<]+)<\/p>/.exec(html);
  if (match === null) {
    throw new Error('missing token html');
  }
  return match[1];
}

(integrationEnabled ? describe : describe.skip)(
  'DHB-34 verify/reset (integration)',
  () => {
    jest.setTimeout(360_000);

    let app: INestApplication;
    let baseUrl: string;
    let prisma: PrismaClient;
    let stop: (() => Promise<void>) | undefined;
    let logs: unknown[];
    let sent: EmailSendParams[];
    let failSend = false;
    let tokenStore: InjectingAuthTokenStore;

    beforeAll(async () => {
      const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
      const databaseUrl = postgres.getConnectionUri();

      execSync('npx prisma migrate deploy', {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      });

      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      await prisma.$connect();

      const connectionConfig: L0ConnectionConfig = {
        databaseUrl,
        redisUrl: 'redis://127.0.0.1:6379',
        databasePoolSize: 5,
      };
      const database = new PrismaDatabaseAdapter(connectionConfig);
      await database.connect();
      const outbox = new PrismaOutboxAdapter(database);
      const registrationStore = new PrismaRegistrationAdapter();
      const sessionStore = new PrismaSessionAdapter(database);
      tokenStore = new InjectingAuthTokenStore(new PrismaAuthTokenAdapter());
      const jwt = generateTestJwtConfig();
      const config = installTestAppConfig({ databaseUrl, jwt });

      logs = [];
      sent = [];
      const logger = {
        info: (fields: unknown) => logs.push(fields),
        warn: (fields: unknown) => logs.push(fields),
        error: (fields: unknown) => logs.push(fields),
        debug: (fields: unknown) => logs.push(fields),
      } as unknown as PlatformLogger;

      const moduleRef = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          RegistrationService,
          PasswordPolicy,
          RegistrationMetrics,
          AuthService,
          AuthMetrics,
          MfaMetrics,
          MfaChallengeService,
          AuthTokenMetrics,
          AccessTokenService,
          AuthTokenService,
          AuthTokensService,
          { provide: APP_CONFIG, useValue: config },
          stubMfaServiceProvider,
          { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
          {
            provide: PASSWORD_BREACH_LIST,
            useValue: { check: async () => 'clear' as const },
          },
          { provide: REGISTRATION_STORE, useValue: registrationStore },
          { provide: SESSION_STORE, useValue: sessionStore },
          { provide: AUTH_TOKEN_STORE, useValue: tokenStore },
          {
            provide: EMAIL_SERVICE,
            useValue: {
              send: async (params: EmailSendParams) => {
                if (failSend) {
                  throw new Error('email down');
                }
                sent.push(params);
                return { id: 'msg-1' };
              },
            },
          },
          { provide: OUTBOX_SERVICE, useValue: outbox },
          OutboxWriterService,
          { provide: PlatformLogger, useValue: logger },
          { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      app.use(correlationExpressMiddleware);
      await app.init();
      await app.listen(0, '127.0.0.1');
      baseUrl = await app.getUrl();

      stop = async () => {
        await app.close();
        await database.disconnect();
        await prisma.$disconnect();
        await postgres.stop();
      };
    });

    afterAll(async () => {
      if (stop) {
        await stop();
      }
    });

    async function post(
      path: string,
      body: unknown,
    ): Promise<{ status: number; raw: string; json: Record<string, unknown> | null }> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CORRELATION_ID_HEADER]: 'cor-dhb34',
        },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      return {
        status: response.status,
        raw,
        json: raw.length === 0 ? null : (JSON.parse(raw) as Record<string, unknown>),
      };
    }

    it('creates an unverified user when email send fails after register', async () => {
      failSend = true;
      const email = `fail-send-${Date.now()}@example.com`;
      const result = await post('/v1/auth/register', {
        email,
        password: PASSWORD,
      });
      failSend = false;
      expect(result.status).toBe(201);
      const user = await prisma.user.findFirst({ where: { email } });
      expect(user).not.toBeNull();
      expect(user?.emailVerifiedAt).toBeNull();
      const rows = await prisma.authToken.findMany({ where: { userId: user!.id } });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.tokenHash.length === 64)).toBe(true);

      const resend = await post('/v1/auth/verify-email/resend', { email });
      expect(resend.status).toBe(200);
      expect(resend.json).toEqual({ status: 'accepted' });
    });

    it('allows login while email is unverified', async () => {
      const email = `unverified-login-${Date.now()}@example.com`;
      await post('/v1/auth/register', { email, password: PASSWORD });
      const login = await post('/v1/auth/login', { email, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.json).toMatchObject({ tokenType: 'Bearer' });
    });

    it('never stores plaintext tokens and consumes verify atomically', async () => {
      const email = `verify-${Date.now()}@example.com`;
      sent.length = 0;
      await post('/v1/auth/register', { email, password: PASSWORD });
      const token = tokenFromHtml(sent[0].html);
      const rows = await prisma.authToken.findMany({
        where: { purpose: 'email_verification' },
      });
      expect(rows.some((row) => JSON.stringify(row) === token)).toBe(false);
      expect(rows.some((row) => row.tokenHash === token)).toBe(false);
      expect(rows.some((row) => row.tokenHash === hashAuthToken(token))).toBe(true);

      const first = await post('/v1/auth/verify-email', { token });
      const second = await post('/v1/auth/verify-email', { token });
      expect(first.status).toBe(204);
      expect(second.status).toBe(401);
      expect(second.json).toMatchObject({ code: ErrorCode.TokenInvalid });

      const user = await prisma.user.findFirst({ where: { email } });
      expect(user?.emailVerifiedAt).not.toBeNull();
      const events = await prisma.outbox.findMany({
        where: { eventType: 'iam.user.email_verified', aggregateId: user!.id },
      });
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain(token);
      expect(JSON.stringify(logs)).not.toContain(token);
      expect(JSON.stringify(logs)).not.toContain(hashAuthToken(token));
    });

    it('rolls back consume when the verified flag write is injected to fail', async () => {
      const email = `inject-${Date.now()}@example.com`;
      sent.length = 0;
      await post('/v1/auth/register', { email, password: PASSWORD });
      const token = tokenFromHtml(sent[0].html);
      tokenStore.failAfterConsume = true;
      const result = await post('/v1/auth/verify-email', { token });
      tokenStore.failAfterConsume = false;
      expect(result.status).toBe(500);
      const user = await prisma.user.findFirst({ where: { email } });
      expect(user?.emailVerifiedAt).toBeNull();
      const row = await prisma.authToken.findUnique({
        where: { tokenHash: hashAuthToken(token) },
      });
      expect(row?.consumedAt).toBeNull();
    });

    it('treats concurrent double-redeem as one success', async () => {
      const email = `race-${Date.now()}@example.com`;
      sent.length = 0;
      await post('/v1/auth/register', { email, password: PASSWORD });
      const token = tokenFromHtml(sent[0].html);
      const [a, b] = await Promise.all([
        post('/v1/auth/verify-email', { token }),
        post('/v1/auth/verify-email', { token }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([204, 401]);
      const user = await prisma.user.findFirst({ where: { email } });
      expect(user?.emailVerifiedAt).not.toBeNull();
      const events = await prisma.outbox.findMany({
        where: { eventType: 'iam.user.email_verified', aggregateId: user!.id },
      });
      expect(events).toHaveLength(1);
    });

    it('does not spend a reset token on a weak password and revokes sessions without clearing TOTP', async () => {
      const email = `reset-${Date.now()}@example.com`;
      await post('/v1/auth/register', { email, password: PASSWORD });
      const login = await post('/v1/auth/login', { email, password: PASSWORD });
      expect(login.status).toBe(200);
      const user = await prisma.user.findFirst({ where: { email } });
      const totp = await prisma.totpSecret.create({
        data: {
          id: generateId(),
          userId: user!.id,
          secretCiphertext: Buffer.from('keep-totp'),
        },
      });

      sent.length = 0;
      await post('/v1/auth/password/reset-request', { email });
      const token = tokenFromHtml(sent[0].html);
      const weak = await post('/v1/auth/password/reset', {
        token,
        password: 'short',
      });
      expect(weak.status).toBe(422);
      const unspent = await prisma.authToken.findUnique({
        where: { tokenHash: hashAuthToken(token) },
      });
      expect(unspent?.consumedAt).toBeNull();

      const reset = await post('/v1/auth/password/reset', {
        token,
        password: NEXT_PASSWORD,
      });
      expect(reset.status).toBe(204);

      const families = await prisma.refreshTokenFamily.findMany({
        where: { userId: user!.id },
      });
      expect(families.length).toBeGreaterThan(0);
      expect(families.every((family) => family.revokedAt !== null)).toBe(true);
      expect(families.every((family) => family.revokedReason === 'password_reset')).toBe(
        true,
      );
      const still = await prisma.totpSecret.findUnique({ where: { id: totp.id } });
      expect(Buffer.from(still!.secretCiphertext)).toEqual(Buffer.from('keep-totp'));

      const oldLogin = await post('/v1/auth/login', { email, password: PASSWORD });
      const newLogin = await post('/v1/auth/login', {
        email,
        password: NEXT_PASSWORD,
      });
      expect(oldLogin.status).toBe(401);
      expect(newLogin.status).toBe(200);
      expect(JSON.stringify(logs)).not.toContain(token);
      expect(JSON.stringify(logs)).not.toContain(NEXT_PASSWORD);
    });
  },
);
