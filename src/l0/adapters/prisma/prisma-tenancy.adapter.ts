import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type { OutboxTransaction } from '../../ports/outbox.port';
import {
  MembershipConflictError,
  type ListedProjectMembership,
  type OrgMembershipRecord,
  type OrgRecord,
  type ProjectInsert,
  type ProjectMembershipInsert,
  type ProjectMembershipRecord,
  type ProjectRecord,
  type ProjectRole,
  type TenancyStore,
} from '../../ports/tenancy-store.port';
import { unwrapOutboxTx } from './outbox-transaction';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaTenancyAdapter implements TenancyStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findLiveOrg(orgId: string): Promise<OrgRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().organization.findFirst({
        where: { id: orgId, deletedAt: null },
      });
      return row === null ? null : toOrg(row);
    } catch (error) {
      throw new L0OperationError('Org lookup failed', error);
    }
  }

  async findActiveOrgMembership(
    orgId: string,
    userId: string,
  ): Promise<OrgMembershipRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().orgMembership.findFirst({
        where: { orgId, userId, revokedAt: null },
      });
      return row === null ? null : toOrgMembership(row);
    } catch (error) {
      throw new L0OperationError('Org membership lookup failed', error);
    }
  }

  async listActiveOrgMemberships(
    userId: string,
  ): Promise<OrgMembershipRecord[]> {
    await this.database.connect();
    try {
      const rows = await this.client().orgMembership.findMany({
        where: {
          userId,
          revokedAt: null,
          organization: { deletedAt: null },
        },
      });
      return rows.map(toOrgMembership);
    } catch (error) {
      throw new L0OperationError('Org membership list failed', error);
    }
  }

  async updateOrgName(orgId: string, name: string): Promise<OrgRecord | null> {
    await this.database.connect();
    try {
      const updated = await this.client().organization.updateMany({
        where: { id: orgId, deletedAt: null },
        data: { name },
      });
      if (updated.count === 0) {
        return null;
      }
      return this.findLiveOrg(orgId);
    } catch (error) {
      throw new L0OperationError('Org update failed', error);
    }
  }

  async insertProjectWithOwner(
    tx: OutboxTransaction,
    project: ProjectInsert,
    membership: ProjectMembershipInsert,
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.project.create({
        data: {
          id: project.id,
          orgId: project.orgId,
          name: project.name,
          settings: project.settings as Prisma.InputJsonValue,
        },
      });
      await prismaTx.projectMembership.create({
        data: {
          id: membership.id,
          projectId: membership.projectId,
          userId: membership.userId,
          role: membership.role,
        },
      });
    } catch (error) {
      throw new L0OperationError('Project create failed', error);
    }
  }

  async findLiveProject(projectId: string): Promise<ProjectRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().project.findFirst({
        where: { id: projectId, deletedAt: null },
      });
      return row === null ? null : toProject(row);
    } catch (error) {
      throw new L0OperationError('Project lookup failed', error);
    }
  }

  async updateProject(
    projectId: string,
    patch: { name?: string; settings?: Record<string, unknown> },
  ): Promise<ProjectRecord | null> {
    await this.database.connect();
    try {
      const updated = await this.client().project.updateMany({
        where: { id: projectId, deletedAt: null },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.settings !== undefined
            ? { settings: patch.settings as Prisma.InputJsonValue }
            : {}),
        },
      });
      if (updated.count === 0) {
        return null;
      }
      return this.findLiveProject(projectId);
    } catch (error) {
      throw new L0OperationError('Project update failed', error);
    }
  }

  async softDeleteProject(
    tx: OutboxTransaction,
    projectId: string,
  ): Promise<boolean> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      const updated = await prismaTx.project.updateMany({
        where: { id: projectId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return updated.count === 1;
    } catch (error) {
      throw new L0OperationError('Project delete failed', error);
    }
  }

  async findActiveProjectMembership(
    projectId: string,
    userId: string,
  ): Promise<ProjectMembershipRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().projectMembership.findFirst({
        where: { projectId, userId, revokedAt: null },
      });
      return row === null ? null : toProjectMembership(row);
    } catch (error) {
      throw new L0OperationError('Project membership lookup failed', error);
    }
  }

  async listActiveProjectMemberships(
    userId: string,
  ): Promise<ListedProjectMembership[]> {
    await this.database.connect();
    try {
      const rows = await this.client().projectMembership.findMany({
        where: {
          userId,
          revokedAt: null,
          project: { deletedAt: null },
        },
        include: { project: { select: { orgId: true } } },
      });
      return rows.map((row) => ({
        projectId: row.projectId,
        orgId: row.project.orgId,
        role: row.role,
      }));
    } catch (error) {
      throw new L0OperationError('Project membership list failed', error);
    }
  }

  async findProjectMembershipById(
    membershipId: string,
  ): Promise<ProjectMembershipRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().projectMembership.findFirst({
        where: { id: membershipId, revokedAt: null },
      });
      return row === null ? null : toProjectMembership(row);
    } catch (error) {
      throw new L0OperationError('Project membership lookup failed', error);
    }
  }

  async insertProjectMembership(
    tx: OutboxTransaction,
    membership: ProjectMembershipInsert,
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.projectMembership.create({
        data: {
          id: membership.id,
          projectId: membership.projectId,
          userId: membership.userId,
          role: membership.role,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new MembershipConflictError();
      }
      throw new L0OperationError('Project membership insert failed', error);
    }
  }

  async updateProjectMembershipRole(
    membershipId: string,
    role: ProjectRole,
  ): Promise<ProjectMembershipRecord | null> {
    await this.database.connect();
    try {
      const updated = await this.client().projectMembership.updateMany({
        where: { id: membershipId, revokedAt: null },
        data: { role },
      });
      if (updated.count === 0) {
        return null;
      }
      return this.findProjectMembershipById(membershipId);
    } catch (error) {
      throw new L0OperationError('Project membership update failed', error);
    }
  }

  async revokeProjectMembership(
    tx: OutboxTransaction,
    membershipId: string,
  ): Promise<ProjectMembershipRecord | null> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      const existing = await prismaTx.projectMembership.findFirst({
        where: { id: membershipId, revokedAt: null },
      });
      if (existing === null) {
        return null;
      }
      const revokedAt = new Date();
      await prismaTx.projectMembership.update({
        where: { id: membershipId },
        data: { revokedAt },
      });
      return toProjectMembership(existing);
    } catch (error) {
      throw new L0OperationError('Project membership revoke failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function toOrg(row: {
  id: string;
  kind: OrgRecord['kind'];
  name: string;
  ownerUserId: string | null;
}): OrgRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    ownerUserId: row.ownerUserId,
  };
}

function toOrgMembership(row: {
  id: string;
  orgId: string;
  userId: string;
  role: OrgMembershipRecord['role'];
}): OrgMembershipRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    role: row.role,
  };
}

function toProject(row: {
  id: string;
  orgId: string;
  name: string;
  settings: Prisma.JsonValue;
}): ProjectRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    settings: asSettings(row.settings),
  };
}

function toProjectMembership(row: {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
}): ProjectMembershipRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
  };
}

function asSettings(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isUniqueConstraintViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === undefined || current === null) {
      return false;
    }

    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (code === 'P2002' || code === '23505') {
        return true;
      }
    }

    const message = current instanceof Error ? current.message : String(current);
    if (/23505|unique constraint failed|duplicate key/i.test(message)) {
      return true;
    }

    current = current instanceof Error ? current.cause : undefined;
  }

  return false;
}
