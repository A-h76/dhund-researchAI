import { Inject, Injectable } from '@nestjs/common';
import { AccessContextService } from '../../iam/authorization/access-context.service';
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
  authorizeOrg,
  authorizeProject,
} from '../../platform/authorization/authorize';
import type { OrgDataRole, ProjectRole } from '../../platform/authorization/roles';
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
    private readonly accessContext: AccessContextService,
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
    const context = await this.accessContext.resolve(userId);
    const authorized = authorizeOrg(context, orgId, org, minimum, MODULE);
    if (org === null) {
      throw notFound({ module: MODULE });
    }
    return {
      org,
      membership: {
        id: `${orgId}:${userId}`,
        orgId: authorized.orgId,
        userId,
        role: authorized.role,
      },
    };
  }

  async requireProject(
    userId: string,
    projectId: string,
    minimum: ProjectRole,
  ): Promise<{
    project: ProjectRecord;
    membership: ProjectMembershipRecord;
  }> {
    if (!isUuid(projectId)) {
      throw notFound({ module: MODULE });
    }
    const project = await this.tenancy.findLiveProject(projectId);
    const context = await this.accessContext.resolve(userId);
    const authorized = authorizeProject(context, projectId, project, minimum, {
      module: MODULE,
    });
    if (project === null) {
      throw notFound({ module: MODULE });
    }
    return {
      project,
      membership: {
        id: `${projectId}:${userId}`,
        projectId,
        userId,
        role: authorized.role,
      },
    };
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
    const context = await this.accessContext.resolve(userId);
    const org = context.orgs.find((row) => row.orgId === project.orgId);
    const projectMembership = context.projects.find(
      (row) => row.projectId === projectId,
    );
    return {
      project,
      orgMembership:
        org === undefined
          ? null
          : {
              id: `${project.orgId}:${userId}`,
              orgId: org.orgId,
              userId,
              role: org.role,
            },
      membership:
        projectMembership === undefined
          ? null
          : {
              id: `${projectId}:${userId}`,
              projectId,
              userId,
              role: projectMembership.role,
            },
    };
  }
}
