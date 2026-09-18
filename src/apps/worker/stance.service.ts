import { Inject, Injectable } from '@nestjs/common';
import type { IGatewayService } from '../../ai/gateway/gateway.port';
import { GatewayExecutionFailedError } from '../../ai/gateway/gateway-execution.errors';
import { GATEWAY_SERVICE } from '../../ai/tokens';
import { EvidenceJobError } from '../../evidence/evidence-job.errors';
import { EvidenceMetrics } from '../../evidence/evidence.metrics';
import { toStoredStance } from '../../evidence/stance-map';
import {
  EVIDENCE_SPINE,
  type EvidenceSpinePort,
} from '../../l0/ports/evidence-spine.port';
import { generateId } from '../../platform/ids/uuid-v7';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { RuntimeRole } from '../../platform/runtime/role';

export interface StanceJobPayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly evidenceId: string;
  readonly claimId?: string;
  readonly correlationId: string;
}

export type StanceJobOutcome =
  | {
      readonly kind: 'completed';
      readonly stance: 'supports' | 'contradicts' | 'neutral' | 'unresolved';
      readonly aiExecutionId: string;
    }
  | {
      readonly kind: 'idempotent';
      readonly stance: 'supports' | 'contradicts' | 'neutral' | 'unresolved';
      readonly aiExecutionId: string;
    };

@Injectable()
export class StanceService {
  constructor(
    @Inject(EVIDENCE_SPINE) private readonly spine: EvidenceSpinePort,
    @Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService,
    private readonly metrics: EvidenceMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async execute(
    payload: StanceJobPayload,
    options?: { onHeartbeat?: () => Promise<void> },
  ): Promise<StanceJobOutcome> {
    const existing = await this.spine.findStanceLabel(payload.runId, payload.evidenceId);
    if (existing !== null) {
      return {
        kind: 'idempotent',
        stance: existing.stance,
        aiExecutionId: existing.aiExecutionId,
      };
    }

    const evidence = await this.spine.findEvidence(payload.evidenceId, payload.projectId);
    if (evidence === null) {
      throw new EvidenceJobError(`Evidence "${payload.evidenceId}" was not found`, false);
    }

    let claimText = evidence.text;
    const claimId = payload.claimId ?? null;
    if (claimId !== null) {
      const claim = await this.spine.findClaim(claimId, payload.projectId);
      if (claim === null) {
        throw new EvidenceJobError(`Claim "${claimId}" was not found in project`, false);
      }
      claimText = claim.text;
    }

    await options?.onHeartbeat?.();

    let gatewayResult;
    try {
      gatewayResult = await this.gateway.execute(
        {
          orgId: payload.orgId,
          projectId: payload.projectId,
          researchRunId: payload.runId,
          correlationId: payload.correlationId,
          runtimeRole: RuntimeRole.Worker,
        },
        {
          capability: 'STANCE',
          claim: claimText,
          documentContent: evidence.text,
        },
      );
    } catch (error) {
      if (error instanceof GatewayExecutionFailedError) {
        throw new EvidenceJobError('Gateway stance execution failed', true, { cause: error });
      }
      throw new EvidenceJobError('Gateway stance execution failed', true, { cause: error });
    }

    if (gatewayResult.capability !== 'STANCE') {
      throw new EvidenceJobError('Gateway returned a non-STANCE result', false);
    }

    const stance = toStoredStance(gatewayResult.stance);
    const persisted = await this.spine.persistStanceLabel({
      outboxId: generateId(),
      runId: payload.runId,
      evidenceId: payload.evidenceId,
      projectId: payload.projectId,
      stance,
      aiExecutionId: gatewayResult.aiExecutionId,
      claimId,
      claimLinkId: claimId !== null ? generateId() : null,
      correlationId: payload.correlationId,
    });

    this.metrics.recordStance(persisted.stance);
    this.logger.info({
      module: 'evidence',
      message: 'stance.labelled',
      runId: payload.runId,
      evidenceId: payload.evidenceId,
      stance: persisted.stance,
      aiExecutionId: gatewayResult.aiExecutionId,
    });

    return {
      kind: 'completed',
      stance: persisted.stance,
      aiExecutionId: persisted.aiExecutionId,
    };
  }
}
