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
import { AuthTokensService } from '../../src/iam/auth/auth-tokens.service';
import { MfaMetrics } from '../../src/iam/auth/mfa.metrics';
import { Argon2PasswordHasher } from '../../src/iam/password/argon2-hasher';
import { PASSWORD_BREACH_LIST } from '../../src/iam/password/breach-list.port';
import { PASSWORD_HASHER } from '../../src/iam/password/password-hasher';
import { PasswordPolicy } from '../../src/iam/password/password-policy';
import { RegistrationMetrics } from '../../src/iam/registration/registration.metrics';
import { RegistrationService } from '../../src/iam/registration/registration.service';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { MfaChallengeService } from '../../src/iam/tokens/mfa-challenge.service';
import { hashRefreshToken } from '../../src/iam/tokens/refresh-token';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaOutboxAdapter } from '../../src/l0/adapters/prisma/prisma-outbox.adapter';
import { PrismaRegistrationAdapter } from '../../src/l0/adapters/prisma/prisma-registration.adapter';
import { PrismaSessionAdapter } from '../../src/l0/adapters/prisma/prisma-session.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import {
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
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { stubMfaServiceProvider } from '../fixtures/stub-mfa-service';
import { accessAuthGuardProviders } from '../fixtures/access-auth-providers';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');
const PASSWORD = 'integration-pass-12';

(integrationEnabled ? describe : describe.skip)(
  'DHB-33 login (integration)',
  () => {
    jest.setTimeout(360_000);

    let app: INestApplication;
    let baseUrl: string;
    let prisma: PrismaClient;
    let stop: (() => Promise<void>) | undefined;
    let logs: unknown[];
    let verifyCalls: string[] = [];

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
      const jwt = generateTestJwtConfig();
      const config = installTestAppConfig({ databaseUrl, jwt });

      logs = [];
      const logger = {
        info: (fields: unknown) => logs.push(fields),
        warn: (fields: unknown) => logs.push(fields),
        error: (fields: unknown) => logs.push(fields),
        debug: (fields: unknown) => logs.push(fields),
      } as unknown as PlatformLogger;

      const realHasher = new Argon2PasswordHasher(config);
      const hasher = {
        hash: (password: string) => realHasher.hash(password),
        verify: async (password: string, encodedHash: string) => {
          verifyCalls.push(encodedHash);
          return realHasher.verify(password, encodedHash);
        },
      };

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
          AccessTokenService,
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
          stubMfaServiceProvider,
          { provide: APP_CONFIG, useValue: config },
          { provide: PASSWORD_HASHER, useValue: hasher },
          {
            provide: PASSWORD_BREACH_LIST,
            useValue: { check: async () => 'clear' as const },
          },
          { provide: REGISTRATION_STORE, useValue: registrationStore },
          { provide: SESSION_STORE, useValue: sessionStore },
          { provide: OUTBOX_SERVICE, useValue: outbox },
          OutboxWriterService,
          { provide: PlatformLogger, useValue: logger },
          { provide: APP_FILTER, useClass: GlobalExceptionFilter },
          ...accessAuthGuardProviders(),
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
      headers: Record<string, string> = {},
    ): Promise<{ status: number; raw: string; json: Record<string, unknown> | null }> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CORRELATION_ID_HEADER]: 'cor-dhb33',
          ...headers,
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

    async function registerAndLogin(email: string): Promise<{
      accessToken: string;
      refreshToken: string;
      userId: string;
    }> {
      const registered = await post('/v1/auth/register', {
        email,
        password: PASSWORD,
        displayName: 'Login User',
      });
      expect(registered.status).toBe(201);
      const login = await post('/v1/auth/login', { email, password: PASSWORD });
      expect(login.status).toBe(200);
      const user = await prisma.user.findFirst({ where: { email } });
      expect(user).not.toBeNull();
      return {
        accessToken: login.json!.accessToken as string,
        refreshToken: login.json!.refreshToken as string,
        userId: user!.id,
      };
    }

    it('persists hashed refresh tokens and emits session.created', async () => {
      const email = `login-${Date.now()}@example.com`;
      const tokens = await registerAndLogin(email);
      const families = await prisma.refreshTokenFamily.findMany({
        where: { userId: tokens.userId },
      });
      expect(families).toHaveLength(1);
      expect(families[0].currentTokenHash).toBe(hashRefreshToken(tokens.refreshToken));
      expect(families[0].currentTokenHash).not.toBe(tokens.refreshToken);
      expect(JSON.stringify(families)).not.toContain(tokens.refreshToken);
      expect(JSON.stringify(families)).not.toContain(PASSWORD);

      const events = await prisma.outbox.findMany({
        where: { eventType: 'iam.session.created', aggregateId: families[0].sessionId },
      });
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain(tokens.refreshToken);
      expect(JSON.stringify(events)).not.toContain(tokens.accessToken);
    });

    it('rotates refresh tokens and revokes the family on reuse', async () => {
      const email = `rotate-${Date.now()}@example.com`;
      const first = await registerAndLogin(email);
      const rotated = await post('/v1/auth/refresh', {
        refreshToken: first.refreshToken,
      });
      expect(rotated.status).toBe(200);
      const next = rotated.json!.refreshToken as string;
      expect(next).not.toBe(first.refreshToken);

      const replay = await post('/v1/auth/refresh', {
        refreshToken: first.refreshToken,
      });
      expect(replay.status).toBe(401);
      expect(replay.json).toMatchObject({ code: ErrorCode.RefreshReuseDetected });

      const families = await prisma.refreshTokenFamily.findMany({
        where: { userId: first.userId },
      });
      expect(families[0].revokedAt).not.toBeNull();
      expect(families[0].revokedReason).toBe('refresh_reuse');
      const session = await prisma.session.findUnique({
        where: { id: families[0].sessionId },
      });
      expect(session?.revokedAt).not.toBeNull();

      const familyEvents = await prisma.outbox.findMany({
        where: { eventType: 'iam.refresh_token.family_revoked' },
      });
      expect(
        familyEvents.some((row) => {
          const payload = row.payload as { data?: { familyId?: string; sessionId?: string } };
          return payload.data?.familyId === families[0].id;
        }),
      ).toBe(true);
      const sessionEvents = await prisma.outbox.findMany({
        where: { eventType: 'iam.session.revoked', aggregateId: families[0].sessionId },
      });
      expect(
        sessionEvents.some((row) => {
          const payload = row.payload as { data?: { reason?: string } };
          return payload.data?.reason === 'refresh_reuse';
        }),
      ).toBe(true);
    });

    it('keeps a second device family valid after reuse on the first', async () => {
      const email = `devices-${Date.now()}@example.com`;
      await post('/v1/auth/register', { email, password: PASSWORD });
      const a = await post('/v1/auth/login', { email, password: PASSWORD });
      const b = await post('/v1/auth/login', { email, password: PASSWORD });
      const tokenA = a.json!.refreshToken as string;
      const tokenB = b.json!.refreshToken as string;
      await post('/v1/auth/refresh', { refreshToken: tokenA });
      const reuse = await post('/v1/auth/refresh', { refreshToken: tokenA });
      expect(reuse.json).toMatchObject({ code: ErrorCode.RefreshReuseDetected });
      const stillB = await post('/v1/auth/refresh', { refreshToken: tokenB });
      expect(stillB.status).toBe(200);
    });

    it('compares unknown email and wrong password bodies and always verifies', async () => {
      const existing = `enum-${Date.now()}@example.com`;
      await post('/v1/auth/register', { email: existing, password: PASSWORD });
      verifyCalls = [];
      const startedUnknown = Date.now();
      const unknown = await post(
        '/v1/auth/login',
        { email: `missing-${Date.now()}@example.com`, password: PASSWORD },
        { [CORRELATION_ID_HEADER]: 'cor-enum-int' },
      );
      const unknownMs = Date.now() - startedUnknown;
      const startedWrong = Date.now();
      const wrong = await post(
        '/v1/auth/login',
        { email: existing, password: 'wrong-password-12' },
        { [CORRELATION_ID_HEADER]: 'cor-enum-int' },
      );
      const wrongMs = Date.now() - startedWrong;

      expect(unknown.status).toBe(401);
      expect(wrong.raw).toBe(unknown.raw);
      expect(verifyCalls).toHaveLength(2);
      expect(Math.abs(unknownMs - wrongMs) / Math.max(unknownMs, wrongMs)).toBeLessThan(
        0.75,
      );
      expect(JSON.stringify(logs)).not.toContain(PASSWORD);
    });

    it('logout-all increments sessionVersion and invalidates tokens', async () => {
      const email = `logout-${Date.now()}@example.com`;
      const tokens = await registerAndLogin(email);
      const result = await post(
        '/v1/auth/logout-all',
        {},
        { authorization: `Bearer ${tokens.accessToken}` },
      );
      expect(result.status).toBe(204);
      expect(result.raw).toBe('');

      const user = await prisma.user.findUnique({ where: { id: tokens.userId } });
      expect(user?.sessionVersion).toBe(2);
      const sessions = await prisma.session.findMany({ where: { userId: tokens.userId } });
      expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
      const families = await prisma.refreshTokenFamily.findMany({
        where: { userId: tokens.userId },
      });
      expect(families.every((family) => family.revokedAt !== null)).toBe(true);

      const stale = await post(
        '/v1/auth/logout-all',
        {},
        { authorization: `Bearer ${tokens.accessToken}` },
      );
      expect(stale.status).toBe(401);
      const staleRefresh = await post('/v1/auth/refresh', {
        refreshToken: tokens.refreshToken,
      });
      expect(staleRefresh.status).toBe(401);
    });

    it('E7: revoked membership does not invalidate a live access token', async () => {
      const email = `e7-${Date.now()}@example.com`;
      const tokens = await registerAndLogin(email);
      await prisma.orgMembership.updateMany({
        where: { userId: tokens.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const result = await post(
        '/v1/auth/logout-all',
        {},
        { authorization: `Bearer ${tokens.accessToken}` },
      );
      expect(result.status).toBe(204);
    });
  },
);
