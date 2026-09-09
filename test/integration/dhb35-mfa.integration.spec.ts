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
import { MfaService } from '../../src/iam/auth/mfa.service';
import { Argon2PasswordHasher } from '../../src/iam/password/argon2-hasher';
import { PASSWORD_BREACH_LIST } from '../../src/iam/password/breach-list.port';
import { PASSWORD_HASHER } from '../../src/iam/password/password-hasher';
import { PasswordPolicy } from '../../src/iam/password/password-policy';
import { RegistrationMetrics } from '../../src/iam/registration/registration.metrics';
import { RegistrationService } from '../../src/iam/registration/registration.service';
import { decodeBase32, generateTotp } from '../../src/iam/mfa/totp';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { MfaChallengeService } from '../../src/iam/tokens/mfa-challenge.service';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaMfaAdapter } from '../../src/l0/adapters/prisma/prisma-mfa.adapter';
import { PrismaOutboxAdapter } from '../../src/l0/adapters/prisma/prisma-outbox.adapter';
import { PrismaRegistrationAdapter } from '../../src/l0/adapters/prisma/prisma-registration.adapter';
import { PrismaSessionAdapter } from '../../src/l0/adapters/prisma/prisma-session.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import {
  MFA_STORE,
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

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');
const PASSWORD = 'integration-pass-12';

(integrationEnabled ? describe : describe.skip)(
  'DHB-35 MFA (integration)',
  () => {
    jest.setTimeout(360_000);

    let app: INestApplication;
    let baseUrl: string;
    let prisma: PrismaClient;
    let stop: (() => Promise<void>) | undefined;

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
      const mfaStore = new PrismaMfaAdapter(database);
      const jwt = generateTestJwtConfig();
      const config = installTestAppConfig({ databaseUrl, jwt });
      const logger = {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
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
          MfaService,
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
          { provide: APP_CONFIG, useValue: config },
          { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
          {
            provide: PASSWORD_BREACH_LIST,
            useValue: { check: async () => 'clear' as const },
          },
          { provide: REGISTRATION_STORE, useValue: registrationStore },
          { provide: SESSION_STORE, useValue: sessionStore },
          { provide: MFA_STORE, useValue: mfaStore },
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
      headers: Record<string, string> = {},
    ): Promise<{ status: number; raw: string; json: Record<string, unknown> | null }> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CORRELATION_ID_HEADER]: 'cor-dhb35',
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

    it('stores only hashed recovery codes and consumes one concurrently', async () => {
      const email = `mfa-${Date.now()}@example.com`;
      const registered = await post('/v1/auth/register', {
        email,
        password: PASSWORD,
        displayName: 'Mfa User',
      });
      expect(registered.status).toBe(201);
      const login = await post('/v1/auth/login', { email, password: PASSWORD });
      expect(login.status).toBe(200);
      const accessToken = login.json!.accessToken as string;
      const enrol = await post(
        '/v1/auth/mfa/totp/enrol',
        {},
        { authorization: `Bearer ${accessToken}` },
      );
      expect(enrol.status).toBe(200);
      const secret = enrol.json!.secret as string;
      const confirm = await post(
        '/v1/auth/mfa/totp/confirm',
        { code: generateTotp(decodeBase32(secret)) },
        { authorization: `Bearer ${accessToken}` },
      );
      expect(confirm.status).toBe(200);
      const recoveryCodes = confirm.json!.recoveryCodes as string[];
      expect(recoveryCodes).toHaveLength(10);

      const rows = await prisma.mfaRecoveryCode.findMany();
      const dumped = JSON.stringify(rows);
      for (const code of recoveryCodes) {
        expect(dumped).not.toContain(code);
        expect(dumped).not.toContain(code.replace(/-/g, ''));
      }
      expect(rows.every((row) => row.codeHash.length === 64)).toBe(true);

      const challenged = await post('/v1/auth/login', { email, password: PASSWORD });
      expect(challenged.status).toBe(401);
      expect(challenged.json).toMatchObject({ code: ErrorCode.MfaRequired });
      const challengeToken = (challenged.json!.details as { challengeToken: string })
        .challengeToken;

      const [first, second] = await Promise.all([
        post('/v1/auth/mfa/verify', {
          challengeToken,
          recoveryCode: recoveryCodes[0],
        }),
        post('/v1/auth/mfa/verify', {
          challengeToken,
          recoveryCode: recoveryCodes[0],
        }),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 401]);
      const failed = first.status === 401 ? first : second;
      expect(failed.json).toMatchObject({ code: ErrorCode.MfaRecoveryInvalid });
    });
  },
);
