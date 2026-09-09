import { TenancyAuthorizer } from '../../src/projects/authorization/tenancy-authorizer';
import { AccessContextMetrics } from '../../src/iam/authorization/access-context.metrics';
import { AccessContextService } from '../../src/iam/authorization/access-context.service';
import { PlatformLogger } from '../../src/platform/logging';
import { MemoryCacheService } from '../fixtures/memory-cache';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { DomainError } from '../../src/platform/errors';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
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
  return tokens.sign({ sub: userId, sid: sessionId, sv: 1 });
}

describe('DHB-36 tenancy authorizer', () => {
  const orgId = generateId();
  const projectId = generateId();
  let tenancy: MemoryTenancyStore;
  let sessions: MemorySessionStore;
  let authorizer: TenancyAuthorizer;
  let tokens: AccessTokenService;

  beforeEach(() => {
    tenancy = new MemoryTenancyStore();
    sessions = new MemorySessionStore();
    const config = installTestAppConfig({ jwt: generateTestJwtConfig() });
    tokens = new AccessTokenService(config, sessions);
    const accessContext = new AccessContextService(
      tenancy,
      new MemoryCacheService(),
      new AccessContextMetrics({
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      } as unknown as PlatformLogger),
    );
    authorizer = new TenancyAuthorizer(tokens, tenancy, accessContext);
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
  });

  it('returns 404 when an org ADMIN has no project membership', async () => {
    const userId = generateId();
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId,
      role: 'ADMIN',
    });
    const token = await bearer(tokens, sessions, userId);
    const user = await authorizer.requireUser(`Bearer ${token}`);
    await expect(
      authorizer.requireProject(user.sub, projectId, 'VIEWER'),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });

  it('returns 403 when VIEWER tries to mutate', async () => {
    const userId = generateId();
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId,
      role: 'MEMBER',
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId,
      userId,
      role: 'VIEWER',
    });
    await expect(
      authorizer.requireProject(userId, projectId, 'EDITOR'),
    ).rejects.toMatchObject({ code: ErrorCode.Forbidden });
  });

  it('returns 404 for BILLING even with a project membership', async () => {
    const userId = generateId();
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId,
      role: 'BILLING',
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId,
      userId,
      role: 'OWNER',
    });
    await expect(
      authorizer.requireProject(userId, projectId, 'VIEWER'),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });

  it('returns 403 for BILLING on org data routes', async () => {
    const userId = generateId();
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId,
      role: 'BILLING',
    });
    await expect(
      authorizer.requireOrg(userId, orgId, 'MEMBER'),
    ).rejects.toMatchObject({ code: ErrorCode.Forbidden });
  });

  it('rejects unauthenticated callers', async () => {
    await expect(authorizer.requireUser(undefined)).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});
