import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENT } from '../../l0/ports/tokens';
import type { AuditEventPort } from '../../l0/ports/audit-event.port';
import { DomainError } from '../../platform/errors/domain-error';
import { ErrorCode } from '../../platform/errors/error-codes';
import { generateId } from '../../platform/ids/uuid-v7';
import { auditedAppendInput } from '../../platform/observability/audit-action';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import type { GatewayContext, GatewayRequest } from '../gateway/gateway.types';
import { BoundaryMetrics } from './boundary-metrics';
import type { BoundaryRefusalReason } from './boundary-reasons';
import type { IDataBoundaryCheck } from './data-boundary.port';
import { findBoundaryRefusal } from './find-boundary-refusal';

export const DATA_BOUNDARY_REFUSED_ACTION = 'ai.data_boundary.refused';

@Injectable()
export class GatewayDataBoundary implements IDataBoundaryCheck {
  constructor(
    @Inject(AUDIT_EVENT) private readonly audit: AuditEventPort,
    private readonly metrics: BoundaryMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async assertAllowed(ctx: GatewayContext, request: GatewayRequest): Promise<void> {
    const reason = findBoundaryRefusal(ctx, request);
    if (reason === undefined) {
      return;
    }

    this.metrics.recordRejection(reason);
    await this.auditRefusal(ctx, request, reason);

    this.logger.info({
      module: 'ai.gateway',
      message: 'ai.data_boundary.refused',
      capability: request.capability,
      reason,
      correlationId: ctx.correlationId,
      orgId: ctx.orgId,
    });

    throw new DomainError(ErrorCode.AiDataBoundaryViolation, {
      module: 'ai.gateway',
      details: { reason },
      serverDetail: { kind: 'data_boundary', reason },
    });
  }

  private async auditRefusal(
    ctx: GatewayContext,
    request: GatewayRequest,
    reason: BoundaryRefusalReason,
  ): Promise<void> {
    try {
      await this.audit.append(
        auditedAppendInput({
          id: generateId(),
          actorType: 'system',
          action: DATA_BOUNDARY_REFUSED_ACTION,
          target: ctx.projectId ?? ctx.orgId,
          correlationId: ctx.correlationId,
          scope: {
            orgId: ctx.orgId,
            capability: request.capability,
            reason,
            ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
            ...(ctx.researchRunId !== undefined ? { researchRunId: ctx.researchRunId } : {}),
          },
        }),
      );
    } catch {
      this.logger.warn({
        module: 'ai.gateway',
        message: 'ai.data_boundary.audit_failed',
        capability: request.capability,
        reason,
        correlationId: ctx.correlationId,
      });
    }
  }
}
