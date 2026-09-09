import { Inject, Injectable } from '@nestjs/common';
import {
  ACCESS_CONTEXT_CACHE_ORG_ID,
  ACCESS_CONTEXT_CACHE_TTL_SECONDS,
  accessContextCacheKey,
  CACHE_SERVICE,
  TENANCY_STORE,
  type CacheService,
  type TenancyStore,
} from '../../l0/ports';
import type { AccessContext } from '../../platform/authorization/access-context';
import { isOrgRole, isProjectRole } from '../../platform/authorization/roles';
import { AccessContextMetrics } from './access-context.metrics';

@Injectable()
export class AccessContextService {
  constructor(
    @Inject(TENANCY_STORE) private readonly tenancy: TenancyStore,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    private readonly metrics: AccessContextMetrics,
  ) {}

  async resolve(userId: string): Promise<AccessContext> {
    const cached = await this.readCache(userId);
    if (cached !== null) {
      this.metrics.recordCacheHit();
      return cached;
    }

    this.metrics.recordCacheMiss();
    const context = await this.loadFromStore(userId);
    await this.writeCache(context);
    return context;
  }

  private async loadFromStore(userId: string): Promise<AccessContext> {
    const [orgs, projects] = await Promise.all([
      this.tenancy.listActiveOrgMemberships(userId),
      this.tenancy.listActiveProjectMemberships(userId),
    ]);
    return {
      userId,
      orgs: orgs.map((row) => ({ orgId: row.orgId, role: row.role })),
      projects: projects.map((row) => ({
        projectId: row.projectId,
        orgId: row.orgId,
        role: row.role,
      })),
    };
  }

  private async readCache(userId: string): Promise<AccessContext | null> {
    try {
      const raw = await this.cache.get(
        ACCESS_CONTEXT_CACHE_ORG_ID,
        accessContextCacheKey(userId),
      );
      if (raw === null) {
        return null;
      }
      return parseAccessContext(raw, userId);
    } catch {
      return null;
    }
  }

  private async writeCache(context: AccessContext): Promise<void> {
    try {
      await this.cache.set(
        ACCESS_CONTEXT_CACHE_ORG_ID,
        accessContextCacheKey(context.userId),
        JSON.stringify(context),
        ACCESS_CONTEXT_CACHE_TTL_SECONDS,
      );
    } catch {
      return;
    }
  }
}

function parseAccessContext(
  raw: string,
  userId: string,
): AccessContext | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.userId !== userId || !Array.isArray(record.orgs) || !Array.isArray(record.projects)) {
    return null;
  }

  const orgs: AccessContext['orgs'][number][] = [];
  for (const row of record.orgs) {
    if (typeof row !== 'object' || row === null) {
      return null;
    }
    const org = row as Record<string, unknown>;
    if (typeof org.orgId !== 'string' || typeof org.role !== 'string' || !isOrgRole(org.role)) {
      return null;
    }
    orgs.push({ orgId: org.orgId, role: org.role });
  }

  const projects: AccessContext['projects'][number][] = [];
  for (const row of record.projects) {
    if (typeof row !== 'object' || row === null) {
      return null;
    }
    const project = row as Record<string, unknown>;
    if (
      typeof project.projectId !== 'string' ||
      typeof project.orgId !== 'string' ||
      typeof project.role !== 'string' ||
      !isProjectRole(project.role)
    ) {
      return null;
    }
    projects.push({
      projectId: project.projectId,
      orgId: project.orgId,
      role: project.role,
    });
  }

  return { userId, orgs, projects };
}
