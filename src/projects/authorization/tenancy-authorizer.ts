import { Inject, Injectable } from '@nestjs/common';
import { readBearerToken } from '../../iam/auth/parse-auth-request';
import { AccessTokenService } from '../../iam/tokens/access-token.service';
import {
  TENANCY_STORE,
  type OrgRecord,
  type OrgMembershipRecord,
  type ProjectMembershipRecord,
  type ProjectRecord,
  type TenancyStore,
} from '../../l0/ports';
import {
  orgRoleAtLeast,
  projectRoleAtLeast,
  type OrgDataRole,
  type ProjectRole,
} from '../../platform/authorization/roles';
import { DomainError, ErrorCode, notFound } from '../../platform/errors';
import { isUuid } from '../../platform/ids/uuid-v7';

const MODULE = 'projects';

export function forbidden(): DomainError {
  return new DomainError(ErrorCode.Forbidden, { module: MODULE });
}

@Injectable()
export class TenancyAuthorizer {
  constructor(
    private readonly accessTokens: AccessTokenService,
    @Inject(TENANCY_STORE) private readonly tenancy: TenancyStore,
  ) {}

  async requireUser(authorization: string | undefined) {
    return this.accessTokens.verify(readBearerToken(authorization));
  }

  async requireOrg(
    userId: string,
    orgId: string,
    minimum: OrgDataRole,
  ): Promise<{ org: OrgRecord; membership: OrgMembershipRecord }> {
    if (!isUuid(orgId)) {
      throw notFound({ module: MODULE });
    }
    const org = await this.tenancy.findLiveOrg(orgId);
    if (org === null) {
      throw notFound({ module: MODULE });
    }
    const membership = await this.tenancy.findActiveOrgMembership(orgId, userId);
    if (membership === null) {
      throw notFound({ module: MODULE });
    }
    if (!orgRoleAtLeast(membership.role, minimum)) {
      throw forbidden();
    }
    return { org, membership };
  }

  async requireProject(
    userId: string,
    projectId: string,
    minimum: ProjectRole,
  ): Promise<{
    project: ProjectRecord;
    membership: ProjectMembershipRecord;
  }> {
    const { project, orgMembership, membership } =
      await this.loadProjectAccess(userId, projectId);
    if (orgMembership?.role === 'BILLING' || membership === null) {
      throw notFound({ module: MODULE });
    }
    if (!projectRoleAtLeast(membership.role, minimum)) {
      throw forbidden();
    }
    return { project, membership };
  }

  async loadProjectAccess(
    userId: string,
    projectId: string,
  ): Promise<{
    project: ProjectRecord;
    orgMembership: OrgMembershipRecord | null;
    membership: ProjectMembershipRecord | null;
  }> {
    if (!isUuid(projectId)) {
      throw notFound({ module: MODULE });
    }
    const project = await this.tenancy.findLiveProject(projectId);
    if (project === null) {
      throw notFound({ module: MODULE });
    }
    const orgMembership = await this.tenancy.findActiveOrgMembership(
      project.orgId,
      userId,
    );
    const membership = await this.tenancy.findActiveProjectMembership(
      projectId,
      userId,
    );
    return { project, orgMembership, membership };
  }
}
