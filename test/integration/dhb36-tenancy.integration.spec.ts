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
import { PrismaAuditEventAdapter } from '../../src/l0/adapters/prisma/prisma-audit-event.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaOutboxAdapter } from '../../src/l0/adapters/prisma/prisma-outbox.adapter';
import { PrismaRegistrationAdapter } from '../../src/l0/adapters/prisma/prisma-registration.adapter';
import { PrismaSessionAdapter } from '../../src/l0/adapters/prisma/prisma-session.adapter';
import { PrismaTenancyAdapter } from '../../src/l0/adapters/prisma/prisma-tenancy.adapter';
import { NoopAccessContextInvalidator } from '../../src/l0/adapters/noop/noop-access-context-invalidator';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import {
  ACCESS_CONTEXT_INVALIDATOR,
  AUDIT_EVENT,
  OUTBOX_SERVICE,
  REGISTRATION_STORE,
  SESSION_STORE,
  TENANCY_STORE,
} from '../../src/l0/ports';
import { APP_CONFIG } from '../../src/platform/config';
import { OutboxWriterService } from '../../src/platform/events';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import { generateId } from '../../src/platform/ids/uuid-v7';
import {
  correlationExpressMiddleware,
  PlatformLogger,
} from '../../src/platform/logging';
import { MembershipsController } from '../../src/projects/memberships.controller';
import { OrgsController } from '../../src/projects/orgs.controller';
import { ProjectsController } from '../../src/projects/projects.controller';
import { TenancyAuthorizer } from '../../src/projects/authorization/tenancy-authorizer';
import { TenancyService } from '../../src/projects/tenancy.service';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { stubMfaServiceProvider } from '../fixtures/stub-mfa-service';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');
const PASSWORD = 'integration-pass-12';

(integrationEnabled ? describe : describe.skip)(
  'DHB-36 tenancy (integration)',
  () => {
    jest.setTimeout(360_000);

    let app: INestApplication;
    let baseUrl: string;
    let prisma: PrismaClient;
    let stop: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      const postgres = await new PostgreSqlContainer(
        'pgvector/pgvector:pg16',
      ).start();
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
      const tenancyStore = new PrismaTenancyAdapter(database);
      const audit = new PrismaAuditEventAdapter(database);
      const jwt = generateTestJwtConfig();
      const config = installTestAppConfig({ databaseUrl, jwt });
      const logger = {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      } as unknown as PlatformLogger;

      const moduleRef = await Test.createTestingModule({
        controllers: [
          AuthController,
          OrgsController,
          ProjectsController,
          MembershipsController,
        ],
        providers: [
          RegistrationService,
          PasswordPolicy,
          RegistrationMetrics,
          AuthService,
          AuthMetrics,
          MfaMetrics,
          MfaChallengeService,
          AccessTokenService,
          TenancyAuthorizer,
          TenancyService,
          OutboxWriterService,
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
          { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
          {
            provide: PASSWORD_BREACH_LIST,
            useValue: { check: async () => 'clear' as const },
          },
          { provide: REGISTRATION_STORE, useValue: registrationStore },
          { provide: SESSION_STORE, useValue: sessionStore },
          { provide: TENANCY_STORE, useValue: tenancyStore },
          { provide: OUTBOX_SERVICE, useValue: outbox },
          { provide: AUDIT_EVENT, useValue: audit },
          {
            provide: ACCESS_CONTEXT_INVALIDATOR,
            useClass: NoopAccessContextInvalidator,
          },
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
      token?: string,
    ): Promise<{ status: number; json: Record<string, unknown> | null }> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        [CORRELATION_ID_HEADER]: 'cor-dhb36',
      };
      if (token !== undefined) {
        headers.authorization = `Bearer ${token}`;
      }
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      return {
        status: response.status,
        json: raw.length === 0 ? null : (JSON.parse(raw) as Record<string, unknown>),
      };
    }

    async function registerAndLogin(email: string): Promise<{
      token: string;
      userId: string;
      orgId: string;
    }> {
      await post('/v1/auth/register', {
        email,
        password: PASSWORD,
        displayName: email,
      });
      const login = await post('/v1/auth/login', { email, password: PASSWORD });
      expect(login.status).toBe(200);
      const token = login.json?.accessToken as string;
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const org = await prisma.organization.findFirstOrThrow({
        where: { ownerUserId: user.id, deletedAt: null },
      });
      return { token, userId: user.id, orgId: org.id };
    }

    it('creates a project with owner membership and outbox in one transaction', async () => {
      const owner = await registerAndLogin(`owner-${generateId()}@example.com`);
      const created = await post(
        `/v1/orgs/${owner.orgId}/projects`,
        { name: 'Atlas' },
        owner.token,
      );
      expect(created.status).toBe(201);
      const projectId = created.json?.id as string;
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      const membership = await prisma.projectMembership.findFirstOrThrow({
        where: { projectId, userId: owner.userId, revokedAt: null },
      });
      const events = await prisma.outbox.findMany({
        where: { eventType: 'projects.project.created' },
      });
      expect(project.name).toBe('Atlas');
      expect(membership.role).toBe('OWNER');
      expect(events.some((row) => row.aggregateId === projectId)).toBe(true);
    });

    it('returns 404 for org ADMIN without project membership', async () => {
      const owner = await registerAndLogin(`iso-${generateId()}@example.com`);
      const created = await post(
        `/v1/orgs/${owner.orgId}/projects`,
        { name: 'Secret' },
        owner.token,
      );
      const projectId = created.json?.id as string;
      const admin = await registerAndLogin(`admin-${generateId()}@example.com`);
      await prisma.orgMembership.create({
        data: {
          id: generateId(),
          orgId: owner.orgId,
          userId: admin.userId,
          role: 'ADMIN',
        },
      });
      const response = await fetch(`${baseUrl}/v1/projects/${projectId}`, {
        headers: {
          authorization: `Bearer ${admin.token}`,
          [CORRELATION_ID_HEADER]: 'cor-dhb36',
        },
      });
      expect(response.status).toBe(404);
      const body = (await response.json()) as { code: string; name?: string };
      expect(body.code).toBe(ErrorCode.NotFound);
      expect(body.name).toBeUndefined();
    });

    it('re-invites after revoke and rejects a concurrent second active membership', async () => {
      const owner = await registerAndLogin(`grant-${generateId()}@example.com`);
      const created = await post(
        `/v1/orgs/${owner.orgId}/projects`,
        { name: 'Crew' },
        owner.token,
      );
      const projectId = created.json?.id as string;
      const member = await registerAndLogin(`mem-${generateId()}@example.com`);
      await prisma.orgMembership.create({
        data: {
          id: generateId(),
          orgId: owner.orgId,
          userId: member.userId,
          role: 'MEMBER',
        },
      });

      const granted = await post(
        `/v1/projects/${projectId}/memberships`,
        { userId: member.userId, role: 'EDITOR' },
        owner.token,
      );
      expect(granted.status).toBe(201);
      const membershipId = granted.json?.id as string;

      const revoke = await fetch(
        `${baseUrl}/v1/projects/${projectId}/memberships/${membershipId}`,
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${owner.token}`,
            [CORRELATION_ID_HEADER]: 'cor-dhb36',
          },
        },
      );
      expect(revoke.status).toBe(204);

      const again = await post(
        `/v1/projects/${projectId}/memberships`,
        { userId: member.userId, role: 'VIEWER' },
        owner.token,
      );
      expect(again.status).toBe(201);

      const other = await registerAndLogin(`dup-${generateId()}@example.com`);
      await prisma.orgMembership.create({
        data: {
          id: generateId(),
          orgId: owner.orgId,
          userId: other.userId,
          role: 'MEMBER',
        },
      });

      const [first, second] = await Promise.all([
        post(
          `/v1/projects/${projectId}/memberships`,
          { userId: other.userId, role: 'EDITOR' },
          owner.token,
        ),
        post(
          `/v1/projects/${projectId}/memberships`,
          { userId: other.userId, role: 'VIEWER' },
          owner.token,
        ),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
    });

    it('soft-deletes a project and writes break-glass audit for org OWNER', async () => {
      const owner = await registerAndLogin(`bg-${generateId()}@example.com`);
      const created = await post(
        `/v1/orgs/${owner.orgId}/projects`,
        { name: 'Glass' },
        owner.token,
      );
      const projectId = created.json?.id as string;
      await prisma.projectMembership.updateMany({
        where: { projectId, userId: owner.userId },
        data: { revokedAt: new Date() },
      });

      const deleted = await fetch(`${baseUrl}/v1/projects/${projectId}`, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`,
          [CORRELATION_ID_HEADER]: 'cor-dhb36',
        },
      });
      expect(deleted.status).toBe(204);

      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      expect(project.deletedAt).not.toBeNull();
      const read = await fetch(`${baseUrl}/v1/projects/${projectId}`, {
        headers: {
          authorization: `Bearer ${owner.token}`,
          [CORRELATION_ID_HEADER]: 'cor-dhb36',
        },
      });
      expect(read.status).toBe(404);

      const events = await prisma.outbox.findMany({
        where: { eventType: 'projects.break_glass.used' },
      });
      expect(events.some((row) => row.aggregateId === projectId)).toBe(true);
      const audits = await prisma.auditEvent.findMany({
        where: { action: 'projects.break_glass.used' },
      });
      expect(audits.length).toBeGreaterThan(0);
    });
  },
);
