import type { ProjectScope } from '../../l0/ports/scoped-store.port';
import { DomainError, ErrorCode, notFound } from '../errors';
import { isUuid } from '../ids/uuid-v7';
import type { AccessContext } from '../authorization/access-context';

export type { ProjectScope };

export function projectScopeFrom(
  context: AccessContext,
  projectId: string,
  module: string,
): ProjectScope {
  if (!isUuid(projectId)) {
    throw notFound({ module });
  }
  const project = context.projects.find((row) => row.projectId === projectId);
  if (project === undefined) {
    throw notFound({ module });
  }
  const org = context.orgs.find((row) => row.orgId === project.orgId);
  if (org?.role === 'BILLING') {
    throw notFound({ module });
  }
  return { projectId };
}

export function paginationInvalid(module = 'api'): DomainError {
  return new DomainError(ErrorCode.PaginationInvalid, { module });
}
