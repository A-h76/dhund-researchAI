import type { Provider } from '@nestjs/common';
import { AccessAuthGuard } from '../../src/iam/authorization/access-auth.guard';
import { AccessContextMetrics } from '../../src/iam/authorization/access-context.metrics';
import { AccessContextService } from '../../src/iam/authorization/access-context.service';
import { OrgRoleGuard } from '../../src/iam/authorization/org-role.guard';
import { ProjectRoleGuard } from '../../src/iam/authorization/project-role.guard';
import { CACHE_SERVICE } from '../../src/l0/ports';
import { MemoryCacheService } from './memory-cache';

export function accessAuthGuardProviders(): Provider[] {
  return [AccessAuthGuard, AccessContextMetrics];
}

export function tenancyGuardProviders(
  cache: MemoryCacheService = new MemoryCacheService(),
): Provider[] {
  return [
    AccessAuthGuard,
    OrgRoleGuard,
    ProjectRoleGuard,
    AccessContextService,
    AccessContextMetrics,
    { provide: CACHE_SERVICE, useValue: cache },
  ];
}
