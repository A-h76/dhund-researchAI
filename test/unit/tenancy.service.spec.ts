import { TenancyService } from '../../src/projects/tenancy.service';
import { TenancyAuthorizer } from '../../src/projects/authorization/tenancy-authorizer';
import { AccessContextMetrics } from '../../src/iam/authorization/access-context.metrics';
import { AccessContextService } from '../../src/iam/authorization/access-context.service';
import { PlatformLogger } from '../../src/platform/logging';
import { MemoryCacheService } from '../fixtures/memory-cache';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { OutboxWriterService } from '../../src/platform/events';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { capturingOutbox } from '../fixtures/capturing-outbox';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemorySessionStore } from '../fixtures/memory-session-store';
import { MemoryTenancyStore } from '../fixtures/memory-tenancy-store';

async function bearer(
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
  return `Bearer ${await tokens.sign({ sub: userId, sid: sessionId, sv: 1 })}`;
}

describe('DHB-36 tenancy service', () => {
  const orgId = generateId();
  let tenancy: MemoryTenancyStore;
  let sessions: MemorySessionStore;
  let tokens: AccessTokenService;
  let service: TenancyService;
  let invalidated: string[];
  let appended: ReturnType<typeof capturingOutbox>['appended'];
  let audits: Array<{ action: string; scope: Record<string, unknown> }>;

  beforeEach(() => {
    tenancy = new MemoryTenancyStore();
    sessions = new MemorySessionStore();
    const config = installTestAppConfig({ jwt: generateTestJwtConfig() });
    tokens = new AccessTokenService(config, sessions);
    const { outbox, appended: events } = capturingOutbox();
    appended = events;
    invalidated = [];
    audits = [];
    tenancy.seedOrg({
      id: orgId,
      kind: 'TEAM',
      name: 'Acme',
      ownerUserId: null,
    });
    service = new TenancyService(
      tenancy,
      outbox,
      {
        append: async (input) => {
          audits.push({ action: input.action, scope: input.scope });
        },
      },
      {
        invalidateAccessContext: async (userId) => {
          invalidated.push(userId);
        },
      },
      new OutboxWriterService(outbox),
      new TenancyAuthorizer(
        tokens,
        tenancy,
        new AccessContextService(
          tenancy,
          new MemoryCacheService(),
          new AccessContextMetrics({
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
            debug: () => undefined,
          } as unknown as PlatformLogger),
        ),
      ),
    );
  });

  it('makes the creator the project OWNER and emits project.created', async () => {
    const userId = generateId();
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId,
      role: 'ADMIN',
    });
    const authorization = await bearer(tokens, sessions, userId);

    const project = await runWithCorrelationIdAsync('cor-create', () =>
      service.createProject(authorization, orgId, { name: 'Atlas' }),
    );

    const membership = await tenancy.findActiveProjectMembership(
      project.id,
      userId,
    );
    expect(membership?.role).toBe('OWNER');
    expect(appended.map((row) => row.eventType)).toEqual([
      'projects.project.created',
    ]);
    expect(invalidated).toEqual([userId]);
  });

  it('rejects assigning a role above the caller', async () => {
    const projectId = generateId();
    const adminId = generateId();
    const targetId = generateId();
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId: adminId,
      role: 'MEMBER',
    });
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId: targetId,
      role: 'MEMBER',
    });
    tenancy.seedProject({
      id: projectId,
      orgId,
      name: 'Atlas',
      settings: {},
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId,
      userId: adminId,
      role: 'ADMIN',
    });
    const authorization = await bearer(tokens, sessions, adminId);

    await expect(
      runWithCorrelationIdAsync('cor-escalate', () =>
        service.grantMembership(authorization, projectId, {
          userId: targetId,
          role: 'OWNER',
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.Forbidden });
  });

  it('invalidates AccessContext on grant, role change, and revoke', async () => {
    const projectId = generateId();
    const ownerId = generateId();
    const targetId = generateId();
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId: ownerId,
      role: 'OWNER',
    });
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId: targetId,
      role: 'MEMBER',
    });
    tenancy.seedProject({
      id: projectId,
      orgId,
      name: 'Atlas',
      settings: {},
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId,
      userId: ownerId,
      role: 'OWNER',
    });
    const authorization = await bearer(tokens, sessions, ownerId);

    const granted = await runWithCorrelationIdAsync('cor-grant', () =>
      service.grantMembership(authorization, projectId, {
        userId: targetId,
        role: 'EDITOR',
      }),
    );
    await runWithCorrelationIdAsync('cor-patch', () =>
      service.patchMembership(authorization, projectId, granted.id, {
        role: 'VIEWER',
      }),
    );
    await runWithCorrelationIdAsync('cor-revoke', () =>
      service.revokeMembership(authorization, projectId, granted.id),
    );

    expect(invalidated).toEqual([targetId, targetId, targetId]);
    expect(audits.map((row) => row.action)).toEqual([
      'projects.membership.added',
      'projects.membership.role_changed',
      'projects.membership.removed',
    ]);
    expect(audits.every((row) => row.scope.target === targetId)).toBe(true);
  });

  it('allows org OWNER break-glass delete without project membership', async () => {
    const projectId = generateId();
    const ownerId = generateId();
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId: ownerId,
      role: 'OWNER',
    });
    tenancy.seedProject({
      id: projectId,
      orgId,
      name: 'Atlas',
      settings: {},
    });
    const authorization = await bearer(tokens, sessions, ownerId);

    await runWithCorrelationIdAsync('cor-bg', () =>
      service.deleteProject(authorization, projectId),
    );

    expect(await tenancy.findLiveProject(projectId)).toBeNull();
    expect(appended.map((row) => row.eventType)).toEqual([
      'projects.project.deleted',
      'projects.break_glass.used',
    ]);
    expect(audits.map((row) => row.action)).toEqual([
      'projects.project.deleted',
      'projects.break_glass.used',
    ]);
  });

  it('does not emit break-glass when a project OWNER deletes', async () => {
    const projectId = generateId();
    const ownerId = generateId();
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId: ownerId,
      role: 'MEMBER',
    });
    tenancy.seedProject({
      id: projectId,
      orgId,
      name: 'Atlas',
      settings: {},
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId,
      userId: ownerId,
      role: 'OWNER',
    });
    const authorization = await bearer(tokens, sessions, ownerId);

    await runWithCorrelationIdAsync('cor-del', () =>
      service.deleteProject(authorization, projectId),
    );

    expect(appended.map((row) => row.eventType)).toEqual([
      'projects.project.deleted',
    ]);
    expect(audits.map((row) => row.action)).toEqual(['projects.project.deleted']);
  });
});
