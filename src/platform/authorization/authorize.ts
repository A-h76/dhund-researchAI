import { DomainError, ErrorCode, notFound } from '../errors';
import { isUuid } from '../ids/uuid-v7';
import type { AccessContext } from './access-context';
import {
  orgRoleAtLeast,
  projectRoleAtLeast,
  type OrgDataRole,
  type ProjectRole,
} from './roles';

const DEFAULT_MODULE = 'projects';

export function authorizeOrg(
  context: AccessContext,
  orgId: string,
  liveOrg: { readonly id: string } | null,
  minimum: OrgDataRole,
  module = DEFAULT_MODULE,
): { readonly orgId: string; readonly role: AccessContext['orgs'][number]['role'] } {
  if (!isUuid(orgId) || liveOrg === null) {
    throw notFound({ module });
  }

  const membership = context.orgs.find((row) => row.orgId === orgId);
  if (membership === undefined) {
    throw notFound({ module });
  }
  if (!orgRoleAtLeast(membership.role, minimum)) {
    throw new DomainError(ErrorCode.Forbidden, { module });
  }
  return membership;
}

export function authorizeProject(
  context: AccessContext,
  projectId: string,
  liveProject: { readonly id: string; readonly orgId: string } | null,
  minimum: ProjectRole,
  options: {
    readonly allowOrgOwnerBreakGlass?: boolean;
    readonly module?: string;
  } = {},
): { readonly role: ProjectRole } {
  const module = options.module ?? DEFAULT_MODULE;
  if (!isUuid(projectId) || liveProject === null) {
    throw notFound({ module });
  }

  const org = context.orgs.find((row) => row.orgId === liveProject.orgId);
  if (org?.role === 'BILLING') {
    throw notFound({ module });
  }

  const membership = context.projects.find(
    (row) => row.projectId === projectId,
  );
  if (membership === undefined) {
    if (
      options.allowOrgOwnerBreakGlass === true &&
      org?.role === 'OWNER'
    ) {
      return { role: 'OWNER' };
    }
    throw notFound({ module });
  }
  if (!projectRoleAtLeast(membership.role, minimum)) {
    throw new DomainError(ErrorCode.Forbidden, { module });
  }
  return { role: membership.role };
}
