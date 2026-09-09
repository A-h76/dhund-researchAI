import { Inject, Injectable } from '@nestjs/common';
import {
  ACCESS_CONTEXT_INVALIDATOR,
  AUDIT_EVENT,
  OUTBOX_SERVICE,
  TENANCY_STORE,
  isMembershipConflict,
  type AccessContextInvalidator,
  type AuditEventPort,
  type OrgRecord,
  type OutboxPort,
  type ProjectInsert,
  type ProjectMembershipRecord,
  type ProjectRecord,
  type TenancyStore,
} from '../l0/ports';
import { canAssignProjectRole } from '../platform/authorization/roles';
import { DomainError, ErrorCode, notFound } from '../platform/errors';
import { OutboxWriterService } from '../platform/events';
import { generateId, isUuid } from '../platform/ids/uuid-v7';
import { requireCorrelationId } from '../platform/logging/correlation-context';
import {
  forbidden,
  TenancyAuthorizer,
} from './authorization/tenancy-authorizer';
import {
  parseMembershipGrant,
  parseMembershipRolePatch,
  parseOrgPatch,
  parseProjectCreate,
  parseProjectPatch,
} from './parse-tenancy-request';

const MODULE = 'projects';

export interface OrgResponse {
  readonly id: string;
  readonly kind: OrgRecord['kind'];
  readonly name: string;
}

export interface ProjectResponse {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly settings: Record<string, unknown>;
}

export interface MembershipResponse {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly role: ProjectMembershipRecord['role'];
}

@Injectable()
export class TenancyService {
  constructor(
    @Inject(TENANCY_STORE) private readonly tenancy: TenancyStore,
    @Inject(OUTBOX_SERVICE) private readonly outbox: OutboxPort,
    @Inject(AUDIT_EVENT) private readonly audit: AuditEventPort,
    @Inject(ACCESS_CONTEXT_INVALIDATOR)
    private readonly accessContext: AccessContextInvalidator,
    private readonly outboxWriter: OutboxWriterService,
    private readonly authorizer: TenancyAuthorizer,
  ) {}

  async getOrg(
    authorization: string | undefined,
    orgId: string,
  ): Promise<OrgResponse> {
    const user = await this.authorizer.requireUser(authorization);
    const { org } = await this.authorizer.requireOrg(user.sub, orgId, 'MEMBER');
    return toOrgResponse(org);
  }

  async patchOrg(
    authorization: string | undefined,
    orgId: string,
    body: unknown,
  ): Promise<OrgResponse> {
    const parsed = parseOrgPatch(body);
    const user = await this.authorizer.requireUser(authorization);
    await this.authorizer.requireOrg(user.sub, orgId, 'ADMIN');
    const org = await this.tenancy.updateOrgName(orgId, parsed.name);
    if (org === null) {
      throw notFound({ module: MODULE });
    }
    return toOrgResponse(org);
  }

  async createProject(
    authorization: string | undefined,
    orgId: string,
    body: unknown,
  ): Promise<ProjectResponse> {
    const parsed = parseProjectCreate(body);
    const user = await this.authorizer.requireUser(authorization);
    const { org } = await this.authorizer.requireOrg(user.sub, orgId, 'ADMIN');
    const projectId = generateId();
    const membershipId = generateId();
    const project: ProjectInsert = {
      id: projectId,
      orgId: org.id,
      name: parsed.name,
      settings: parsed.settings,
    };

    await this.outbox.withTransaction(async (tx) => {
      await this.tenancy.insertProjectWithOwner(tx, project, {
        id: membershipId,
        projectId,
        userId: user.sub,
        role: 'OWNER',
      });
      await this.outboxWriter.appendInTransaction(tx, {
        eventType: 'projects.project.created',
        aggregateType: 'project',
        aggregateId: projectId,
        orgId: org.id,
        projectId,
        payload: {
          orgId: org.id,
          projectId,
          name: parsed.name,
          createdBy: user.sub,
        },
      });
    });

    await this.accessContext.invalidateAccessContext(user.sub);
    return {
      id: projectId,
      orgId: org.id,
      name: parsed.name,
      settings: parsed.settings,
    };
  }

  async getProject(
    authorization: string | undefined,
    projectId: string,
  ): Promise<ProjectResponse> {
    const user = await this.authorizer.requireUser(authorization);
    const { project } = await this.authorizer.requireProject(
      user.sub,
      projectId,
      'VIEWER',
    );
    return toProjectResponse(project);
  }

  async patchProject(
    authorization: string | undefined,
    projectId: string,
    body: unknown,
  ): Promise<ProjectResponse> {
    const parsed = parseProjectPatch(body);
    const user = await this.authorizer.requireUser(authorization);
    await this.authorizer.requireProject(user.sub, projectId, 'EDITOR');
    const project = await this.tenancy.updateProject(projectId, parsed);
    if (project === null) {
      throw notFound({ module: MODULE });
    }
    return toProjectResponse(project);
  }

  async deleteProject(
    authorization: string | undefined,
    projectId: string,
  ): Promise<void> {
    const user = await this.authorizer.requireUser(authorization);
    const { project, orgMembership, membership } =
      await this.authorizer.loadProjectAccess(user.sub, projectId);

    if (orgMembership?.role === 'BILLING') {
      throw notFound({ module: MODULE });
    }

    if (membership === null) {
      if (orgMembership?.role === 'OWNER') {
        await this.breakGlassDelete(user.sub, project);
        return;
      }
      throw notFound({ module: MODULE });
    }

    if (membership.role !== 'OWNER') {
      throw forbidden();
    }

    await this.outbox.withTransaction(async (tx) => {
      await this.tenancy.softDeleteProject(tx, project.id);
    });
  }

  async grantMembership(
    authorization: string | undefined,
    projectId: string,
    body: unknown,
  ): Promise<MembershipResponse> {
    const parsed = parseMembershipGrant(body);
    const user = await this.authorizer.requireUser(authorization);
    const { project, membership: actor } = await this.authorizer.requireProject(
      user.sub,
      projectId,
      'ADMIN',
    );
    if (!canAssignProjectRole(actor.role, parsed.role)) {
      throw forbidden();
    }
    const targetOrg = await this.tenancy.findActiveOrgMembership(
      project.orgId,
      parsed.userId,
    );
    if (targetOrg === null) {
      throw notFound({ module: MODULE });
    }

    const membershipId = generateId();
    try {
      await this.outbox.withTransaction(async (tx) => {
        await this.tenancy.insertProjectMembership(tx, {
          id: membershipId,
          projectId: project.id,
          userId: parsed.userId,
          role: parsed.role,
        });
        await this.outboxWriter.appendInTransaction(tx, {
          eventType: 'projects.membership.added',
          aggregateType: 'project_membership',
          aggregateId: membershipId,
          orgId: project.orgId,
          projectId: project.id,
          payload: {
            orgId: project.orgId,
            projectId: project.id,
            userId: parsed.userId,
            role: parsed.role,
          },
        });
      });
    } catch (error) {
      if (isMembershipConflict(error)) {
        throw new DomainError(ErrorCode.AlreadyExists, { module: MODULE });
      }
      throw error;
    }

    await this.auditMembership(
      'projects.membership.added',
      user.sub,
      parsed.userId,
      parsed.role,
      project,
    );
    await this.accessContext.invalidateAccessContext(parsed.userId);
    return {
      id: membershipId,
      projectId: project.id,
      userId: parsed.userId,
      role: parsed.role,
    };
  }

  async patchMembership(
    authorization: string | undefined,
    projectId: string,
    membershipId: string,
    body: unknown,
  ): Promise<MembershipResponse> {
    const parsed = parseMembershipRolePatch(body);
    const user = await this.authorizer.requireUser(authorization);
    const { project, membership: actor } = await this.authorizer.requireProject(
      user.sub,
      projectId,
      'ADMIN',
    );
    if (!isUuid(membershipId)) {
      throw notFound({ module: MODULE });
    }
    if (!canAssignProjectRole(actor.role, parsed.role)) {
      throw forbidden();
    }
    const existing = await this.tenancy.findProjectMembershipById(membershipId);
    if (existing === null || existing.projectId !== project.id) {
      throw notFound({ module: MODULE });
    }
    const updated = await this.tenancy.updateProjectMembershipRole(
      membershipId,
      parsed.role,
    );
    if (updated === null) {
      throw notFound({ module: MODULE });
    }
    await this.auditMembership(
      'projects.membership.role_changed',
      user.sub,
      updated.userId,
      parsed.role,
      project,
    );
    await this.accessContext.invalidateAccessContext(updated.userId);
    return toMembershipResponse(updated);
  }

  async revokeMembership(
    authorization: string | undefined,
    projectId: string,
    membershipId: string,
  ): Promise<void> {
    const user = await this.authorizer.requireUser(authorization);
    const { project } = await this.authorizer.requireProject(
      user.sub,
      projectId,
      'ADMIN',
    );
    if (!isUuid(membershipId)) {
      throw notFound({ module: MODULE });
    }
    const existing = await this.tenancy.findProjectMembershipById(membershipId);
    if (existing === null || existing.projectId !== project.id) {
      throw notFound({ module: MODULE });
    }

    await this.outbox.withTransaction(async (tx) => {
      const revoked = await this.tenancy.revokeProjectMembership(tx, membershipId);
      if (revoked === null) {
        throw notFound({ module: MODULE });
      }
      await this.outboxWriter.appendInTransaction(tx, {
        eventType: 'projects.membership.removed',
        aggregateType: 'project_membership',
        aggregateId: membershipId,
        orgId: project.orgId,
        projectId: project.id,
        payload: {
          orgId: project.orgId,
          projectId: project.id,
          userId: revoked.userId,
        },
      });
    });

    await this.auditMembership(
      'projects.membership.removed',
      user.sub,
      existing.userId,
      existing.role,
      project,
    );
    await this.accessContext.invalidateAccessContext(existing.userId);
  }

  private async breakGlassDelete(
    actorUserId: string,
    project: ProjectRecord,
  ): Promise<void> {
    await this.outbox.withTransaction(async (tx) => {
      const deleted = await this.tenancy.softDeleteProject(tx, project.id);
      if (!deleted) {
        throw notFound({ module: MODULE });
      }
      await this.outboxWriter.appendInTransaction(tx, {
        eventType: 'projects.break_glass.used',
        aggregateType: 'project',
        aggregateId: project.id,
        orgId: project.orgId,
        projectId: project.id,
        payload: {
          orgId: project.orgId,
          userId: actorUserId,
          projectId: project.id,
        },
      });
    });
    await this.audit.append({
      id: generateId(),
      actorType: 'user',
      action: 'projects.break_glass.used',
      correlationId: requireCorrelationId(),
      scope: {
        actorUserId,
        orgId: project.orgId,
        projectId: project.id,
      },
    });
  }

  private async auditMembership(
    action: string,
    actorUserId: string,
    targetUserId: string,
    role: string,
    project: ProjectRecord,
  ): Promise<void> {
    await this.audit.append({
      id: generateId(),
      actorType: 'user',
      action,
      correlationId: requireCorrelationId(),
      scope: {
        actorUserId,
        targetUserId,
        role,
        orgId: project.orgId,
        projectId: project.id,
      },
    });
  }
}

function toOrgResponse(org: OrgRecord): OrgResponse {
  return { id: org.id, kind: org.kind, name: org.name };
}

function toProjectResponse(project: ProjectRecord): ProjectResponse {
  return {
    id: project.id,
    orgId: project.orgId,
    name: project.name,
    settings: project.settings,
  };
}

function toMembershipResponse(
  membership: ProjectMembershipRecord,
): MembershipResponse {
  return {
    id: membership.id,
    projectId: membership.projectId,
    userId: membership.userId,
    role: membership.role,
  };
}
