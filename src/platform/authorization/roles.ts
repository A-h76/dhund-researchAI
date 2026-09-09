export const PROJECT_ROLES = ['VIEWER', 'EDITOR', 'ADMIN', 'OWNER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ORG_DATA_ROLES = ['MEMBER', 'ADMIN', 'OWNER'] as const;
export type OrgDataRole = (typeof ORG_DATA_ROLES)[number];

export const ORG_ROLES = ['BILLING', ...ORG_DATA_ROLES] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const PROJECT_RANK: Record<ProjectRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
  OWNER: 3,
};

const ORG_DATA_RANK: Record<OrgDataRole, number> = {
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

export function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value);
}

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function isOrgDataRole(value: string): value is OrgDataRole {
  return (ORG_DATA_ROLES as readonly string[]).includes(value);
}

export function projectRoleAtLeast(
  actual: string,
  minimum: ProjectRole,
): boolean {
  if (!isProjectRole(actual)) {
    return false;
  }
  return PROJECT_RANK[actual] >= PROJECT_RANK[minimum];
}

export function orgRoleAtLeast(actual: string, minimum: OrgDataRole): boolean {
  if (actual === 'BILLING' || !isOrgDataRole(actual)) {
    return false;
  }
  return ORG_DATA_RANK[actual] >= ORG_DATA_RANK[minimum];
}

export function canAssignProjectRole(
  callerRole: string,
  grantedRole: ProjectRole,
): boolean {
  return projectRoleAtLeast(callerRole, grantedRole);
}
