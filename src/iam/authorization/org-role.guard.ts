import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TENANCY_STORE, type TenancyStore } from '../../l0/ports';
import type { OrgDataRole } from '../../platform/authorization/roles';
import { authorizeOrg } from '../../platform/authorization/authorize';
import { DomainError, ErrorCode, notFound } from '../../platform/errors';
import { AccessContextService } from './access-context.service';
import { AccessContextMetrics } from './access-context.metrics';
import {
  ACCESS_CONTEXT_KEY,
  ACCESS_USER_ID_KEY,
  REQUIRE_ORG_ROLE_KEY,
} from './metadata';
import {
  readPathParam,
  type AccessAwareRequest,
} from './request-access';

const MODULE = 'projects';

@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessContext: AccessContextService,
    @Inject(TENANCY_STORE) private readonly tenancy: TenancyStore,
    private readonly metrics: AccessContextMetrics,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const minimum = this.reflector.get<OrgDataRole | undefined>(
      REQUIRE_ORG_ROLE_KEY,
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

    const orgId = readPathParam(request, 'orgId');
    try {
      if (orgId === undefined) {
        throw notFound({ module: MODULE });
      }
      const [liveOrg, snapshot] = await Promise.all([
        this.tenancy.findLiveOrg(orgId),
        this.accessContext.resolve(userId),
      ]);
      authorizeOrg(snapshot, orgId, liveOrg, minimum, MODULE);
      request[ACCESS_CONTEXT_KEY] = snapshot;
      return true;
    } catch (error) {
      recordAuthzDenial(this.metrics, error);
      throw error;
    }
  }
}

export function recordAuthzDenial(
  metrics: AccessContextMetrics,
  error: unknown,
): void {
  if (error instanceof DomainError && error.code === ErrorCode.Forbidden) {
    metrics.recordDenial('forbidden');
    return;
  }
  metrics.recordDenial('not_found');
}
