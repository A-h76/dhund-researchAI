import { L0OperationError } from './errors';
import type { OutboxTransaction } from './outbox.port';

export class MembershipConflictError extends L0OperationError {
  constructor() {
    super('membership conflict');
    this.name = 'MembershipConflictError';
  }
}

export function isMembershipConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (current instanceof MembershipConflictError) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export type OrgKind = 'PERSONAL' | 'TEAM';
export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'BILLING';
export type ProjectRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface OrgRecord {
  readonly id: string;
  readonly kind: OrgKind;
  readonly name: string;
  readonly ownerUserId: string | null;
}

export interface OrgMembershipRecord {
  readonly id: string;
  readonly orgId: string;
  readonly userId: string;
  readonly role: OrgRole;
}

export interface ProjectRecord {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly settings: Record<string, unknown>;
}

export interface ProjectMembershipRecord {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly role: ProjectRole;
}

export interface ProjectInsert {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly settings: Record<string, unknown>;
}

export interface ProjectMembershipInsert {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly role: ProjectRole;
}

export interface TenancyStore {
  findLiveOrg(orgId: string): Promise<OrgRecord | null>;
  findActiveOrgMembership(
    orgId: string,
    userId: string,
  ): Promise<OrgMembershipRecord | null>;
  updateOrgName(orgId: string, name: string): Promise<OrgRecord | null>;
  insertProjectWithOwner(
    tx: OutboxTransaction,
    project: ProjectInsert,
    membership: ProjectMembershipInsert,
  ): Promise<void>;
  findLiveProject(projectId: string): Promise<ProjectRecord | null>;
  updateProject(
    projectId: string,
    patch: { name?: string; settings?: Record<string, unknown> },
  ): Promise<ProjectRecord | null>;
  softDeleteProject(tx: OutboxTransaction, projectId: string): Promise<boolean>;
  findActiveProjectMembership(
    projectId: string,
    userId: string,
  ): Promise<ProjectMembershipRecord | null>;
  findProjectMembershipById(
    membershipId: string,
  ): Promise<ProjectMembershipRecord | null>;
  insertProjectMembership(
    tx: OutboxTransaction,
    membership: ProjectMembershipInsert,
  ): Promise<void>;
  updateProjectMembershipRole(
    membershipId: string,
    role: ProjectRole,
  ): Promise<ProjectMembershipRecord | null>;
  revokeProjectMembership(
    tx: OutboxTransaction,
    membershipId: string,
  ): Promise<ProjectMembershipRecord | null>;
}
