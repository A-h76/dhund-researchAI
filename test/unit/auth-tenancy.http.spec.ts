import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import {
  ACCESS_CONTEXT_INVALIDATOR,
  AUDIT_EVENT,
  OUTBOX_SERVICE,
  SESSION_STORE,
  TENANCY_STORE,
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
import { MembershipsController } from '../../src/projects/memberships.controller';
import { OrgsController } from '../../src/projects/orgs.controller';
import { ProjectsController } from '../../src/projects/projects.controller';
import { TenancyAuthorizer } from '../../src/projects/authorization/tenancy-authorizer';
import { TenancyService } from '../../src/projects/tenancy.service';
import type { OrgRole, ProjectRole } from '../../src/l0/ports/tenancy-store.port';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { capturingOutbox } from '../fixtures/capturing-outbox';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemorySessionStore } from '../fixtures/memory-session-store';
import { MemoryTenancyStore } from '../fixtures/memory-tenancy-store';
import { tenancyGuardProviders } from '../fixtures/access-auth-providers';

async function json(
  baseUrl: string,
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    [CORRELATION_ID_HEADER]: 'cor-tenancy-http',
    ...opts.headers,
  };
  if (opts.token !== undefined) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const raw = await response.text();
  return {
    status: response.status,
    body: raw.length === 0 ? null : (JSON.parse(raw) as Record<string, unknown>),
  };
}

async function startApp(featureFlags: Record<string, boolean> = {}): Promise<{
  app: INestApplication;
  baseUrl: string;
  tenancy: MemoryTenancyStore;
  sessions: MemorySessionStore;
  tokens: AccessTokenService;
  orgId: string;
  projectId: string;
}> {
  const logs: unknown[] = [];
  const logger = {
    info: (fields: unknown) => logs.push(fields),
    warn: (fields: unknown) => logs.push(fields),
    error: (fields: unknown) => logs.push(fields),
    debug: (fields: unknown) => logs.push(fields),
  } as unknown as PlatformLogger;

  const jwt = generateTestJwtConfig();
  const config = installTestAppConfig({ jwt, featureFlags });
  const sessions = new MemorySessionStore();
  const tenancy = new MemoryTenancyStore();
  const orgId = generateId();
  const projectId = generateId();
  tenancy.seedOrg({
    id: orgId,
    kind: 'TEAM',
    name: 'Acme',
    ownerUserId: null,
  });
  tenancy.seedProject({
    id: projectId,
    orgId,
    name: 'Atlas',
    settings: {},
  });
  const { outbox } = capturingOutbox();

  const moduleRef = await Test.createTestingModule({
    controllers: [OrgsController, ProjectsController, MembershipsController],
    providers: [
      TenancyService,
      TenancyAuthorizer,
      AccessTokenService,
      OutboxWriterService,
      ...tenancyGuardProviders(),
      { provide: APP_CONFIG, useValue: config },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: TENANCY_STORE, useValue: tenancy },
      { provide: OUTBOX_SERVICE, useValue: outbox },
      { provide: AUDIT_EVENT, useValue: { append: async () => undefined } },
      {
        provide: ACCESS_CONTEXT_INVALIDATOR,
        useValue: { invalidateAccessContext: async () => undefined },
      },
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
    tenancy,
    sessions,
    tokens: app.get(AccessTokenService),
    orgId,
    projectId,
  };
}

async function tokenFor(
  tokens: AccessTokenService,
  sessions: MemorySessionStore,
  userId: string,
): Promise<string> {
  const sessionId = generateId();
  sessions.sessions.set(sessionId, {
    sessionId,
    userId,
    revokedAt: null,
    userSessionVersion: 1,
  });
  return tokens.sign({ sub: userId, sid: sessionId, sv: 1 });
}

function seedActor(
  tenancy: MemoryTenancyStore,
  orgId: string,
  projectId: string,
  orgRole: OrgRole,
  projectRole?: ProjectRole,
): string {
  const userId = generateId();
  tenancy.seedOrgMembership({
    id: generateId(),
    orgId,
    userId,
    role: orgRole,
  });
  if (projectRole !== undefined) {
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId,
      userId,
      role: projectRole,
    });
  }
  return userId;
}

describe('DHB-36 tenancy HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tenancy: MemoryTenancyStore;
  let sessions: MemorySessionStore;
  let tokens: AccessTokenService;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    const started = await startApp();
    app = started.app;
    baseUrl = started.baseUrl;
    tenancy = started.tenancy;
    sessions = started.sessions;
    tokens = started.tokens;
    orgId = started.orgId;
    projectId = started.projectId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects missing bearer with 401', async () => {
    const response = await json(baseUrl, 'GET', `/v1/orgs/${orgId}`);
    expect(response.status).toBe(401);
    expect(response.body?.code).toBe(ErrorCode.Unauthenticated);
  });

  it('returns org data for MEMBER and 403 for BILLING', async () => {
    const member = seedActor(tenancy, orgId, projectId, 'MEMBER');
    const billing = seedActor(tenancy, orgId, projectId, 'BILLING');
    const memberRes = await json(baseUrl, 'GET', `/v1/orgs/${orgId}`, {
      token: await tokenFor(tokens, sessions, member),
    });
    const billingRes = await json(baseUrl, 'GET', `/v1/orgs/${orgId}`, {
      token: await tokenFor(tokens, sessions, billing),
    });
    expect(memberRes.status).toBe(200);
    expect(memberRes.body).toMatchObject({ id: orgId, name: 'Acme', kind: 'TEAM' });
    expect(billingRes.status).toBe(403);
    expect(billingRes.body?.code).toBe(ErrorCode.Forbidden);
    expect(billingRes.body).not.toHaveProperty('name');
  });

  it('lets ADMIN patch org and forbids MEMBER', async () => {
    const admin = seedActor(tenancy, orgId, projectId, 'ADMIN');
    const member = seedActor(tenancy, orgId, projectId, 'MEMBER');
    const forbidden = await json(baseUrl, 'PATCH', `/v1/orgs/${orgId}`, {
      token: await tokenFor(tokens, sessions, member),
      body: { name: 'Nope' },
    });
    const allowed = await json(baseUrl, 'PATCH', `/v1/orgs/${orgId}`, {
      token: await tokenFor(tokens, sessions, admin),
      body: { name: 'Acme Two' },
    });
    expect(forbidden.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(allowed.body?.name).toBe('Acme Two');
  });

  it('lets OWNER create a project and forbids MEMBER', async () => {
    const owner = seedActor(tenancy, orgId, projectId, 'OWNER');
    const member = seedActor(tenancy, orgId, projectId, 'MEMBER');
    const denied = await json(baseUrl, 'POST', `/v1/orgs/${orgId}/projects`, {
      token: await tokenFor(tokens, sessions, member),
      body: { name: 'Denied' },
    });
    const created = await json(baseUrl, 'POST', `/v1/orgs/${orgId}/projects`, {
      token: await tokenFor(tokens, sessions, owner),
      body: { name: 'Nova' },
    });
    expect(denied.status).toBe(403);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Nova', orgId });
  });

  it('returns 404 for org ADMIN without project membership (org-role-as-project-access)', async () => {
    const admin = seedActor(tenancy, orgId, projectId, 'ADMIN');
    const response = await json(baseUrl, 'GET', `/v1/projects/${projectId}`, {
      token: await tokenFor(tokens, sessions, admin),
    });
    expect(response.status).toBe(404);
    expect(response.body?.code).toBe(ErrorCode.NotFound);
    expect(response.body).not.toHaveProperty('name');
  });

  it('returns 404 for BILLING on project routes even with membership', async () => {
    const billing = seedActor(tenancy, orgId, projectId, 'BILLING', 'OWNER');
    const response = await json(baseUrl, 'GET', `/v1/projects/${projectId}`, {
      token: await tokenFor(tokens, sessions, billing),
    });
    expect(response.status).toBe(404);
    expect(response.body).not.toHaveProperty('name');
  });

  it('allows VIEWER to read and forbids VIEWER mutation', async () => {
    const viewer = seedActor(tenancy, orgId, projectId, 'MEMBER', 'VIEWER');
    const token = await tokenFor(tokens, sessions, viewer);
    const read = await json(baseUrl, 'GET', `/v1/projects/${projectId}`, {
      token,
    });
    const mutate = await json(baseUrl, 'PATCH', `/v1/projects/${projectId}`, {
      token,
      body: { name: 'Hacked' },
    });
    expect(read.status).toBe(200);
    expect(read.body?.name).toBe('Atlas');
    expect(mutate.status).toBe(403);
  });

  it('allows EDITOR to patch and forbids EDITOR member management', async () => {
    const editor = seedActor(tenancy, orgId, projectId, 'MEMBER', 'EDITOR');
    const target = seedActor(tenancy, orgId, projectId, 'MEMBER');
    const token = await tokenFor(tokens, sessions, editor);
    const patched = await json(baseUrl, 'PATCH', `/v1/projects/${projectId}`, {
      token,
      body: { name: 'Atlas Prime' },
    });
    const members = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectId}/memberships`,
      { token, body: { userId: target, role: 'VIEWER' } },
    );
    expect(patched.status).toBe(200);
    expect(patched.body?.name).toBe('Atlas Prime');
    expect(members.status).toBe(403);
  });

  it('lets project ADMIN grant membership and rejects a second active row', async () => {
    const admin = seedActor(tenancy, orgId, projectId, 'MEMBER', 'ADMIN');
    const target = seedActor(tenancy, orgId, projectId, 'MEMBER');
    const token = await tokenFor(tokens, sessions, admin);
    const granted = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectId}/memberships`,
      { token, body: { userId: target, role: 'VIEWER' } },
    );
    const duplicate = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectId}/memberships`,
      { token, body: { userId: target, role: 'EDITOR' } },
    );
    expect(granted.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body?.code).toBe(ErrorCode.AlreadyExists);
  });

  it('reads projectId from the path, not the body', async () => {
    const otherProject = generateId();
    tenancy.seedProject({
      id: otherProject,
      orgId,
      name: 'Other',
      settings: {},
    });
    const viewer = seedActor(tenancy, orgId, projectId, 'MEMBER', 'VIEWER');
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId: otherProject,
      userId: viewer,
      role: 'OWNER',
    });
    const response = await json(baseUrl, 'PATCH', `/v1/projects/${projectId}`, {
      token: await tokenFor(tokens, sessions, viewer),
      body: { name: 'FromBody', projectId: otherProject },
    });
    expect(response.status).toBe(403);
  });

  it('soft-deletes for project OWNER and 404s later reads', async () => {
    const doomed = generateId();
    tenancy.seedProject({
      id: doomed,
      orgId,
      name: 'Doomed',
      settings: {},
    });
    const owner = seedActor(tenancy, orgId, doomed, 'MEMBER', 'OWNER');
    const token = await tokenFor(tokens, sessions, owner);
    const deleted = await json(baseUrl, 'DELETE', `/v1/projects/${doomed}`, {
      token,
    });
    const read = await json(baseUrl, 'GET', `/v1/projects/${doomed}`, { token });
    const patched = await json(baseUrl, 'PATCH', `/v1/projects/${doomed}`, {
      token,
      body: { name: 'Still here' },
    });
    expect(deleted.status).toBe(204);
    expect(read.status).toBe(404);
    expect(patched.status).toBe(404);
  });

  it('allows org OWNER break-glass delete and 404s GET/PATCH without membership', async () => {
    const doomed = generateId();
    tenancy.seedProject({
      id: doomed,
      orgId,
      name: 'Glass',
      settings: {},
    });
    const orgOwner = seedActor(tenancy, orgId, doomed, 'OWNER');
    const token = await tokenFor(tokens, sessions, orgOwner);
    const get = await json(baseUrl, 'GET', `/v1/projects/${doomed}`, { token });
    const patch = await json(baseUrl, 'PATCH', `/v1/projects/${doomed}`, {
      token,
      body: { name: 'Nope' },
    });
    const deleted = await json(baseUrl, 'DELETE', `/v1/projects/${doomed}`, {
      token,
    });
    expect(get.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(deleted.status).toBe(204);
  });

  it('does not give org ADMIN break-glass', async () => {
    const doomed = generateId();
    tenancy.seedProject({
      id: doomed,
      orgId,
      name: 'NoGlass',
      settings: {},
    });
    const admin = seedActor(tenancy, orgId, doomed, 'ADMIN');
    const response = await json(baseUrl, 'DELETE', `/v1/projects/${doomed}`, {
      token: await tokenFor(tokens, sessions, admin),
    });
    expect(response.status).toBe(404);
    expect(await tenancy.findLiveProject(doomed)).not.toBeNull();
  });

  it('returns 404 for unknown org', async () => {
    const member = seedActor(tenancy, orgId, projectId, 'MEMBER');
    const response = await json(baseUrl, 'GET', `/v1/orgs/${generateId()}`, {
      token: await tokenFor(tokens, sessions, member),
    });
    expect(response.status).toBe(404);
  });

  it('re-invites after revoke and patches membership role', async () => {
    const admin = seedActor(tenancy, orgId, projectId, 'MEMBER', 'ADMIN');
    const target = seedActor(tenancy, orgId, projectId, 'MEMBER');
    const token = await tokenFor(tokens, sessions, admin);
    const granted = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectId}/memberships`,
      { token, body: { userId: target, role: 'VIEWER' } },
    );
    expect(granted.status).toBe(201);
    const membershipId = granted.body?.id as string;
    const revoked = await json(
      baseUrl,
      'DELETE',
      `/v1/projects/${projectId}/memberships/${membershipId}`,
      { token },
    );
    expect(revoked.status).toBe(204);
    const again = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectId}/memberships`,
      { token, body: { userId: target, role: 'EDITOR' } },
    );
    expect(again.status).toBe(201);
    const patched = await json(
      baseUrl,
      'PATCH',
      `/v1/projects/${projectId}/memberships/${again.body?.id as string}`,
      { token, body: { role: 'VIEWER' } },
    );
    expect(patched.status).toBe(200);
    expect(patched.body?.role).toBe('VIEWER');
  });

  it('E7 accepted residual: revoked membership does not invalidate the access token', async () => {
    const admin = seedActor(tenancy, orgId, projectId, 'MEMBER', 'ADMIN');
    const target = seedActor(tenancy, orgId, projectId, 'MEMBER', 'VIEWER');
    const adminToken = await tokenFor(tokens, sessions, admin);
    const targetToken = await tokenFor(tokens, sessions, target);
    const membership = tenancy.projectMemberships.find(
      (row) => row.userId === target && row.projectId === projectId,
    );
    expect(membership).toBeDefined();
    const revoked = await json(
      baseUrl,
      'DELETE',
      `/v1/projects/${projectId}/memberships/${membership!.id}`,
      { token: adminToken },
    );
    expect(revoked.status).toBe(204);
    const project = await json(baseUrl, 'GET', `/v1/projects/${projectId}`, {
      token: targetToken,
    });
    const org = await json(baseUrl, 'GET', `/v1/orgs/${orgId}`, {
      token: targetToken,
    });
    expect(project.status).toBe(404);
    expect(org.status).toBe(200);
    expect(org.body?.id).toBe(orgId);
  });
});

describe('DHB-36 feature-flag independence', () => {
  it('keeps authorization identical when flags flip', async () => {
    const off = await startApp({ research_runs: false });
    const on = await startApp({ research_runs: true });
    try {
      const adminOff = seedActor(off.tenancy, off.orgId, off.projectId, 'ADMIN');
      const adminOn = seedActor(on.tenancy, on.orgId, on.projectId, 'ADMIN');
      const [a, b] = await Promise.all([
        json(off.baseUrl, 'GET', `/v1/projects/${off.projectId}`, {
          token: await tokenFor(off.tokens, off.sessions, adminOff),
        }),
        json(on.baseUrl, 'GET', `/v1/projects/${on.projectId}`, {
          token: await tokenFor(on.tokens, on.sessions, adminOn),
        }),
      ]);
      expect(a.status).toBe(404);
      expect(b.status).toBe(404);
      expect(a.body?.code).toBe(b.body?.code);
    } finally {
      await off.app.close();
      await on.app.close();
    }
  });
});
