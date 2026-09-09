import { AccessContextMetrics } from '../../src/iam/authorization/access-context.metrics';
import { AccessContextService } from '../../src/iam/authorization/access-context.service';
import { RedisAccessContextInvalidator } from '../../src/l0/adapters/redis/redis-access-context-invalidator';
import {
  ACCESS_CONTEXT_CACHE_ORG_ID,
  accessContextCacheKey,
} from '../../src/l0/ports/access-context-cache';
import type { CacheService } from '../../src/l0/ports/cache.port';
import { PlatformLogger } from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { MemoryCacheService } from '../fixtures/memory-cache';
import { MemoryTenancyStore } from '../fixtures/memory-tenancy-store';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

function throwingCache(): CacheService {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => false,
    get: async () => {
      throw new Error('down');
    },
    set: async () => {
      throw new Error('down');
    },
    del: async () => {
      throw new Error('down');
    },
  };
}

describe('DHB-37 AccessContext resolver', () => {
  const orgId = generateId();
  const projectId = generateId();
  const userId = generateId();

  let tenancy: MemoryTenancyStore;
  let cache: MemoryCacheService;
  let metrics: AccessContextMetrics;
  let service: AccessContextService;

  beforeEach(() => {
    tenancy = new MemoryTenancyStore();
    cache = new MemoryCacheService();
    metrics = new AccessContextMetrics(stubLogger());
    service = new AccessContextService(tenancy, cache, metrics);
    tenancy.seedOrg({
      id: orgId,
      kind: 'TEAM',
      name: 'Acme',
      ownerUserId: null,
    });
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId,
      userId,
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
      userId,
      role: 'VIEWER',
    });
  });

  it('loads from the store on miss and serves the next call from cache', async () => {
    const listOrgs = jest.spyOn(tenancy, 'listActiveOrgMemberships');
    const first = await service.resolve(userId);
    const second = await service.resolve(userId);
    expect(first.projects).toEqual([
      { projectId, orgId, role: 'VIEWER' },
    ]);
    expect(second).toEqual(first);
    expect(listOrgs).toHaveBeenCalledTimes(1);
    expect(metrics.snapshot()).toMatchObject({
      cacheHit: 1,
      cacheMiss: 1,
    });
  });

  it('rebuilds from Postgres after invalidation or a cache flush', async () => {
    await service.resolve(userId);
    const invalidator = new RedisAccessContextInvalidator(cache);
    await invalidator.invalidateAccessContext(userId);
    expect(
      await cache.get(ACCESS_CONTEXT_CACHE_ORG_ID, accessContextCacheKey(userId)),
    ).toBeNull();

    const listOrgs = jest.spyOn(tenancy, 'listActiveOrgMemberships');
    await service.resolve(userId);
    expect(listOrgs).toHaveBeenCalledTimes(1);

    cache.clear();
    await service.resolve(userId);
    expect(listOrgs).toHaveBeenCalledTimes(2);
  });

  it('does not 500 when Redis get/set/del fail', async () => {
    const down = new AccessContextService(tenancy, throwingCache(), metrics);
    await expect(down.resolve(userId)).resolves.toMatchObject({
      userId,
      orgs: [{ orgId, role: 'MEMBER' }],
    });
    await expect(
      new RedisAccessContextInvalidator(throwingCache()).invalidateAccessContext(
        userId,
      ),
    ).resolves.toBeUndefined();
  });

  it('omits memberships for soft-deleted projects', async () => {
    await tenancy.softDeleteProject({} as never, projectId);
    const context = await service.resolve(userId);
    expect(context.projects).toEqual([]);
  });
});
