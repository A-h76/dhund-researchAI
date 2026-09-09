import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { AuthController } from '../../src/iam/auth.controller';
import { AuthService } from '../../src/iam/auth/auth.service';
import { AuthTokensService } from '../../src/iam/auth/auth-tokens.service';
import { stubMfaServiceProvider } from '../fixtures/stub-mfa-service';
import { Argon2PasswordHasher } from '../../src/iam/password/argon2-hasher';
import { PASSWORD_BREACH_LIST } from '../../src/iam/password/breach-list.port';
import { PASSWORD_HASHER } from '../../src/iam/password/password-hasher';
import { PasswordPolicy } from '../../src/iam/password/password-policy';
import { RegistrationMetrics } from '../../src/iam/registration/registration.metrics';
import { RegistrationService } from '../../src/iam/registration/registration.service';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaOutboxAdapter } from '../../src/l0/adapters/prisma/prisma-outbox.adapter';
import { PrismaRegistrationAdapter } from '../../src/l0/adapters/prisma/prisma-registration.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { OUTBOX_SERVICE, REGISTRATION_STORE } from '../../src/l0/ports';
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

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');
const PASSWORD = 'integration-pass-12';
const BREACHED = 'breached-pass12';

(integrationEnabled ? describe : describe.skip)(
  'DHB-32 registration (integration)',
  () => {
    jest.setTimeout(360_000);

    let app: INestApplication;
    let baseUrl: string;
    let prisma: PrismaClient;
    let stop: (() => Promise<void>) | undefined;
    let hasherCalls = 0;
    let logs: unknown[];
    let breachVerdict: 'clear' | 'breached' | 'unavailable' = 'clear';

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
      const store = new PrismaRegistrationAdapter();
      const config = installTestAppConfig({ databaseUrl });

      logs = [];
      const logger = {
        info: (fields: unknown) => logs.push(fields),
        warn: (fields: unknown) => logs.push(fields),
        error: (fields: unknown) => logs.push(fields),
        debug: (fields: unknown) => logs.push(fields),
      } as unknown as PlatformLogger;

      const realHasher = new Argon2PasswordHasher(config);
      const hasher = {
        hash: async (password: string) => {
          hasherCalls += 1;
          return realHasher.hash(password);
        },
        verify: async (password: string, encodedHash: string) =>
          realHasher.verify(password, encodedHash),
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
          { provide: APP_CONFIG, useValue: config },
          { provide: PASSWORD_HASHER, useValue: hasher },
          {
            provide: PASSWORD_BREACH_LIST,
            useValue: {
              check: async () => breachVerdict,
            },
          },
          { provide: REGISTRATION_STORE, useValue: store },
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

    async function postRegister(
      email: string,
      password = PASSWORD,
      displayName?: string,
    ): Promise<{ status: number; raw: string; json: Record<string, unknown> }> {
      const response = await fetch(`${baseUrl}/v1/auth/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CORRELATION_ID_HEADER]: `cor-${email}`,
        },
        body: JSON.stringify({
          email,
          password,
          ...(displayName !== undefined ? { displayName } : {}),
        }),
      });
      const raw = await response.text();
      return {
        status: response.status,
        raw,
        json: JSON.parse(raw) as Record<string, unknown>,
      };
    }

    it('creates user, credential, personal org, owner membership, and outbox event atomically', async () => {
      const email = `new-${Date.now()}@example.com`;
      const result = await postRegister(email, PASSWORD, 'Ada Lovelace');

      expect(result.status).toBe(201);
      expect(result.json).toEqual({ status: 'pending_verification' });
      expect(result.raw).not.toContain(PASSWORD);

      const user = await prisma.user.findFirst({ where: { email } });
      expect(user).not.toBeNull();
      expect(user?.emailVerifiedAt).toBeNull();
      expect(user?.displayName).toBe('Ada Lovelace');

      const credential = await prisma.credential.findFirst({
        where: { userId: user!.id },
      });
      expect(credential?.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(credential?.passwordHash).toContain('m=65536');
      expect(credential?.passwordHash).toContain('t=3');
      expect(credential?.passwordHash).toContain('p=4');
      expect(credential?.passwordHash).not.toContain(PASSWORD);

      const orgs = await prisma.organization.findMany({
        where: { ownerUserId: user!.id, kind: 'PERSONAL', deletedAt: null },
      });
      expect(orgs).toHaveLength(1);

      const memberships = await prisma.orgMembership.findMany({
        where: { userId: user!.id, orgId: orgs[0].id, revokedAt: null },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe('OWNER');

      const events = await prisma.outbox.findMany({
        where: { eventType: 'iam.user.registered', aggregateId: user!.id },
      });
      expect(events).toHaveLength(1);
      const payload = events[0].payload as {
        data?: Record<string, unknown>;
      };
      expect(payload.data).toMatchObject({
        orgId: orgs[0].id,
        userId: user!.id,
        email,
        displayName: 'Ada Lovelace',
      });
      expect(JSON.stringify(payload)).not.toContain(PASSWORD);
      expect(JSON.stringify(payload)).not.toContain(credential!.passwordHash);

      const audits = await prisma.auditEvent.findMany({
        where: { action: 'iam.user.registered', correlationId: `cor-${email}` },
      });
      expect(audits.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits)).not.toContain(PASSWORD);
      expect(JSON.stringify(audits)).not.toContain(credential!.passwordHash);
    });

    it('returns identical HTTP status and body for existing vs new email', async () => {
      const existing = `existing-${Date.now()}@example.com`;
      const fresh = `fresh-${Date.now()}@example.com`;
      const first = await postRegister(existing);
      const duplicate = await postRegister(existing);
      const created = await postRegister(fresh);

      expect(first.status).toBe(201);
      expect(duplicate.status).toBe(created.status);
      expect(duplicate.raw).toBe(created.raw);
      expect(duplicate.json).toEqual({ status: 'pending_verification' });
      expect(duplicate.raw).not.toContain('email_taken');
      expect(duplicate.raw).not.toMatch(/users_email_key|uq_org_personal_owner|P2002/);

      const users = await prisma.user.findMany({ where: { email: existing } });
      expect(users).toHaveLength(1);
      const events = await prisma.outbox.findMany({
        where: { eventType: 'iam.user.registered', aggregateId: users[0].id },
      });
      expect(events).toHaveLength(1);
    });

    it('creates exactly one durable registration under concurrent double POST', async () => {
      const email = `concurrent-${Date.now()}@example.com`;
      const [a, b] = await Promise.all([postRegister(email), postRegister(email)]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.raw).toBe(b.raw);

      const users = await prisma.user.findMany({ where: { email } });
      expect(users).toHaveLength(1);
      const orgs = await prisma.organization.findMany({
        where: { ownerUserId: users[0].id, kind: 'PERSONAL', deletedAt: null },
      });
      expect(orgs).toHaveLength(1);
      const memberships = await prisma.orgMembership.findMany({
        where: { userId: users[0].id, revokedAt: null },
      });
      expect(memberships).toHaveLength(1);
      const events = await prisma.outbox.findMany({
        where: { eventType: 'iam.user.registered', aggregateId: users[0].id },
      });
      expect(events).toHaveLength(1);
    });

    it('rejects a known-breached password and accepts when the breach list is forced down', async () => {
      breachVerdict = 'breached';
      const blocked = await postRegister(
        `breached-${Date.now()}@example.com`,
        BREACHED,
      );
      expect(blocked.status).toBe(422);
      expect(blocked.json).toMatchObject({
        code: ErrorCode.ValidationError,
        details: { fields: [{ field: 'password', rule: 'breached' }] },
      });
      expect(blocked.raw).not.toContain(BREACHED);

      breachVerdict = 'unavailable';
      const allowed = await postRegister(
        `offline-${Date.now()}@example.com`,
        BREACHED,
      );
      expect(allowed.status).toBe(201);
      expect(JSON.stringify(logs)).toContain('password.breach_list.degraded');
      expect(JSON.stringify(logs)).not.toContain(BREACHED);
      expect(JSON.stringify(logs)).not.toContain(PASSWORD);
      breachVerdict = 'clear';
    });

    it('instrumented hasher runs for both new and existing emails', async () => {
      const before = hasherCalls;
      const email = `hash-both-${Date.now()}@example.com`;
      await postRegister(email);
      await postRegister(email);
      expect(hasherCalls - before).toBe(2);
    });
  },
);
