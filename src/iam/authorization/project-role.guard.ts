import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TENANCY_STORE, type TenancyStore } from '../../l0/ports';
import { authorizeProject } from '../../platform/authorization/authorize';
import type { ProjectRole } from '../../platform/authorization/roles';
import { DomainError, ErrorCode, notFound } from '../../platform/errors';
import { AccessContextService } from './access-context.service';
import { AccessContextMetrics } from './access-context.metrics';
import { recordAuthzDenial } from './org-role.guard';
import {
  ACCESS_CONTEXT_KEY,
  ACCESS_USER_ID_KEY,
  REQUIRE_PROJECT_ROLE_KEY,
} from './metadata';
import {
  readPathParam,
  type AccessAwareRequest,
} from './request-access';

const MODULE = 'projects';

@Injectable()
export class ProjectRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessContext: AccessContextService,
    @Inject(TENANCY_STORE) private readonly tenancy: TenancyStore,
    private readonly metrics: AccessContextMetrics,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const minimum = this.reflector.get<ProjectRole | undefined>(
      REQUIRE_PROJECT_ROLE_KEY,
      context.getHandler(),
    );
    if (minimum === undefined) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AccessAwareRequest>();
    const userId = request[ACCESS_USER_ID_KEY];
    if (userId === undefined) {
      this.metrics.recordDenial('unauthenticated');
      throw new DomainError(ErrorCode.Unauthenticated, { module: 'iam' });
    }

    const projectId = readPathParam(request, 'projectId');
    const method = request.method?.toUpperCase();
    try {
      if (projectId === undefined) {
        throw notFound({ module: MODULE });
      }
      const [liveProject, snapshot] = await Promise.all([
        this.tenancy.findLiveProject(projectId),
        this.accessContext.resolve(userId),
      ]);
      authorizeProject(snapshot, projectId, liveProject, minimum, {
        module: MODULE,
        allowOrgOwnerBreakGlass: method === 'DELETE' && minimum === 'OWNER',
      });
      request[ACCESS_CONTEXT_KEY] = snapshot;
      return true;
    } catch (error) {
      recordAuthzDenial(this.metrics, error);
      throw error;
    }
  }
}
