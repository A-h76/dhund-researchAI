import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENT, type AuditEventPort } from '../l0/ports';
import { generateId } from '../platform/ids/uuid-v7';
import { requireCorrelationId } from '../platform/logging/correlation-context';
import { auditedAppendInput } from '../platform/observability/audit-action';

export const MERGE_APPROVED_ACTION = 'identity.merge.approved';

@Injectable()
export class MergeApprovalService {
  constructor(@Inject(AUDIT_EVENT) private readonly audit: AuditEventPort) {}

  async approve(input: {
    readonly actorId: string;
    readonly mergeCandidateId: string;
    readonly orgId: string;
    readonly projectId?: string;
  }): Promise<void> {
    await this.audit.append(
      auditedAppendInput({
        id: generateId(),
        actorType: 'user',
        actorId: input.actorId,
        action: MERGE_APPROVED_ACTION,
        target: input.mergeCandidateId,
        correlationId: requireCorrelationId(),
        scope: {
          orgId: input.orgId,
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        },
      }),
    );
  }
}
