import type { OrgRole, ProjectRole } from './roles';

export interface AccessContextOrg {
  readonly orgId: string;
  readonly role: OrgRole;
}

export interface AccessContextProject {
  readonly projectId: string;
  readonly orgId: string;
  readonly role: ProjectRole;
}

export interface AccessContext {
  readonly userId: string;
  readonly orgs: ReadonlyArray<AccessContextOrg>;
  readonly projects: ReadonlyArray<AccessContextProject>;
}
