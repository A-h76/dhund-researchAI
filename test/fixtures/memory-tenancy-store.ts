import type { OutboxTransaction } from '../../src/l0/ports/outbox.port';
import { MembershipConflictError } from '../../src/l0/ports/tenancy-store.port';
import type {
  OrgMembershipRecord,
  OrgRecord,
  ProjectInsert,
  ProjectMembershipInsert,
  ProjectMembershipRecord,
  ProjectRecord,
  ProjectRole,
  TenancyStore,
} from '../../src/l0/ports/tenancy-store.port';

interface StoredOrg {
  id: string;
  kind: OrgRecord['kind'];
  name: string;
  ownerUserId: string | null;
  deletedAt: Date | null;
}

interface StoredOrgMembership {
  id: string;
  orgId: string;
  userId: string;
  role: OrgMembershipRecord['role'];
  revokedAt: Date | null;
}

interface StoredProject {
  id: string;
  orgId: string;
  name: string;
  settings: Record<string, unknown>;
  deletedAt: Date | null;
}

interface StoredProjectMembership {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  revokedAt: Date | null;
}

export class MemoryTenancyStore implements TenancyStore {
  readonly orgs = new Map<string, StoredOrg>();
  readonly orgMemberships: StoredOrgMembership[] = [];
  readonly projects = new Map<string, StoredProject>();
  readonly projectMemberships: StoredProjectMembership[] = [];

  seedOrg(org: OrgRecord): void {
    this.orgs.set(org.id, { ...org, deletedAt: null });
  }

  seedOrgMembership(membership: OrgMembershipRecord): void {
    this.orgMemberships.push({ ...membership, revokedAt: null });
  }

  seedProject(project: ProjectRecord): void {
    this.projects.set(project.id, { ...project, deletedAt: null });
  }

  seedProjectMembership(membership: ProjectMembershipRecord): void {
    this.projectMemberships.push({ ...membership, revokedAt: null });
  }

  async findLiveOrg(orgId: string): Promise<OrgRecord | null> {
    const org = this.orgs.get(orgId);
    if (org === undefined || org.deletedAt !== null) {
      return null;
    }
    return { id: org.id, kind: org.kind, name: org.name, ownerUserId: org.ownerUserId };
  }

  async findActiveOrgMembership(
    orgId: string,
    userId: string,
  ): Promise<OrgMembershipRecord | null> {
    const found = this.orgMemberships.find(
      (row) => row.orgId === orgId && row.userId === userId && row.revokedAt === null,
    );
    return found === undefined ? null : toOrgMembership(found);
  }

  async updateOrgName(orgId: string, name: string): Promise<OrgRecord | null> {
    const org = this.orgs.get(orgId);
    if (org === undefined || org.deletedAt !== null) {
      return null;
    }
    org.name = name;
    return this.findLiveOrg(orgId);
  }

  async insertProjectWithOwner(
    _tx: OutboxTransaction,
    project: ProjectInsert,
    membership: ProjectMembershipInsert,
  ): Promise<void> {
    this.projects.set(project.id, { ...project, deletedAt: null });
    this.projectMemberships.push({ ...membership, revokedAt: null });
  }

  async findLiveProject(projectId: string): Promise<ProjectRecord | null> {
    const project = this.projects.get(projectId);
    if (project === undefined || project.deletedAt !== null) {
      return null;
    }
    return {
      id: project.id,
      orgId: project.orgId,
      name: project.name,
      settings: { ...project.settings },
    };
  }

  async updateProject(
    projectId: string,
    patch: { name?: string; settings?: Record<string, unknown> },
  ): Promise<ProjectRecord | null> {
    const project = this.projects.get(projectId);
    if (project === undefined || project.deletedAt !== null) {
      return null;
    }
    if (patch.name !== undefined) {
      project.name = patch.name;
    }
    if (patch.settings !== undefined) {
      project.settings = { ...patch.settings };
    }
    return this.findLiveProject(projectId);
  }

  async softDeleteProject(
    _tx: OutboxTransaction,
    projectId: string,
  ): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (project === undefined || project.deletedAt !== null) {
      return false;
    }
    project.deletedAt = new Date();
    return true;
  }

  async findActiveProjectMembership(
    projectId: string,
    userId: string,
  ): Promise<ProjectMembershipRecord | null> {
    const found = this.projectMemberships.find(
      (row) =>
        row.projectId === projectId &&
        row.userId === userId &&
        row.revokedAt === null,
    );
    return found === undefined ? null : toProjectMembership(found);
  }

  async findProjectMembershipById(
    membershipId: string,
  ): Promise<ProjectMembershipRecord | null> {
    const found = this.projectMemberships.find(
      (row) => row.id === membershipId && row.revokedAt === null,
    );
    return found === undefined ? null : toProjectMembership(found);
  }

  async insertProjectMembership(
    _tx: OutboxTransaction,
    membership: ProjectMembershipInsert,
  ): Promise<void> {
    const duplicate = this.projectMemberships.some(
      (row) =>
        row.projectId === membership.projectId &&
        row.userId === membership.userId &&
        row.revokedAt === null,
    );
    if (duplicate) {
      throw new MembershipConflictError();
    }
    this.projectMemberships.push({ ...membership, revokedAt: null });
  }

  async updateProjectMembershipRole(
    membershipId: string,
    role: ProjectRole,
  ): Promise<ProjectMembershipRecord | null> {
    const found = this.projectMemberships.find(
      (row) => row.id === membershipId && row.revokedAt === null,
    );
    if (found === undefined) {
      return null;
    }
    found.role = role;
    return toProjectMembership(found);
  }

  async revokeProjectMembership(
    _tx: OutboxTransaction,
    membershipId: string,
  ): Promise<ProjectMembershipRecord | null> {
    const found = this.projectMemberships.find(
      (row) => row.id === membershipId && row.revokedAt === null,
    );
    if (found === undefined) {
      return null;
    }
    found.revokedAt = new Date();
    return toProjectMembership(found);
  }
}

function toOrgMembership(row: StoredOrgMembership): OrgMembershipRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    role: row.role,
  };
}

function toProjectMembership(
  row: StoredProjectMembership,
): ProjectMembershipRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
  };
}
