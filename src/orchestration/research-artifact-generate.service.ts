import { Inject, Injectable } from '@nestjs/common';
import type { IGatewayService } from '../ai/gateway/gateway.port';
import { GatewayExecutionFailedError } from '../ai/gateway/gateway-execution.errors';
import { GATEWAY_SERVICE } from '../ai/tokens';
import {
  RESEARCH_RUN_STORE,
  assertResearchRunCoverageForFinalize,
  hashResearchRunCoverage,
  type ResearchRunCoverage,
  type ResearchRunStore,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId } from '../platform/ids/uuid-v7';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import { RuntimeRole } from '../platform/runtime/role';
import {
  isResearchArtifactType,
  type ResearchArtifactTypeName,
} from './research-artifact-types';
import { ResearchRunMetrics } from './research-run.metrics';
import { ResearchArtifactsRepository } from './scoped-repos';

const MODULE = 'orchestration';

export interface ResearchArtifactGeneratePayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly artifactType: string;
  readonly coverageSnapshotHash: string;
  readonly coverageSnapshot: ResearchRunCoverage;
  readonly correlationId: string;
}

export type ResearchArtifactGenerateOutcome =
  | {
      readonly kind: 'created';
      readonly artifactId: string;
      readonly aiExecutionId: string;
      readonly coverageSnapshotHash: string;
    }
  | {
      readonly kind: 'idempotent';
      readonly artifactId: string;
      readonly aiExecutionId: string;
      readonly coverageSnapshotHash: string;
    };

@Injectable()
export class ResearchArtifactGenerateService {
  constructor(
    @Inject(RESEARCH_RUN_STORE) private readonly store: ResearchRunStore,
    @Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService,
    private readonly artifacts: ResearchArtifactsRepository,
    private readonly metrics: ResearchRunMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async execute(
    payload: ResearchArtifactGeneratePayload,
  ): Promise<ResearchArtifactGenerateOutcome> {
    if (!isResearchArtifactType(payload.artifactType)) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: `Unknown research artifact type "${payload.artifactType}"`,
      });
    }

    const coverage = assertResearchRunCoverageForFinalize(payload.coverageSnapshot);
    const expectedHash = hashResearchRunCoverage(coverage);
    if (expectedHash !== payload.coverageSnapshotHash) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'coverageSnapshotHash does not match frozen coverage snapshot',
      });
    }

    const run = await this.store.getById(payload.runId);
    if (run === null) {
      throw new DomainError(ErrorCode.NotFound, {
        module: MODULE,
        userMessage: 'Research run not found.',
      });
    }

    const existing = await this.artifacts.findByCoverageHash(
      { projectId: payload.projectId },
      payload.runId,
      payload.artifactType,
      payload.coverageSnapshotHash,
    );
    if (existing !== null) {
      return {
        kind: 'idempotent',
        artifactId: existing.id,
        aiExecutionId: String(existing.aiExecutionId),
        coverageSnapshotHash: payload.coverageSnapshotHash,
      };
    }

    let aiExecutionId: string;
    try {
      const result = await this.gateway.execute(
        {
          orgId: payload.orgId,
          projectId: payload.projectId,
          researchRunId: payload.runId,
          correlationId: payload.correlationId,
          runtimeRole: RuntimeRole.Worker,
        },
        {
          capability: 'SYNTHESIS',
          evidenceSummaries: [
            `Research artifact ${payload.artifactType} under frozen coverage ${payload.coverageSnapshotHash}`,
          ],
        },
      );
      if (result.capability !== 'SYNTHESIS') {
        throw new DomainError(ErrorCode.ValidationError, {
          module: MODULE,
          userMessage: 'Gateway returned a non-SYNTHESIS result for artifact generation',
        });
      }
      aiExecutionId = result.aiExecutionId;
    } catch (error) {
      this.metrics.recordArtifactFailed();
      this.logger.info({
        module: MODULE,
        message: 'research_artifact.generate.failed',
        runId: payload.runId,
        artifactType: payload.artifactType,
        coverageSnapshotHash: payload.coverageSnapshotHash,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof GatewayExecutionFailedError || error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(ErrorCode.UpstreamUnavailable, {
        module: MODULE,
        userMessage: 'Artifact generation failed; no artifact row written.',
        cause: error instanceof Error ? error : undefined,
      });
    }

    // Persist only after successful AI execution — never an empty artifact row.
    const created = await this.artifacts.create(
      { projectId: payload.projectId },
      {
        id: generateId(),
        runId: payload.runId,
        type: payload.artifactType as ResearchArtifactTypeName,
        coverageSnapshot: coverage,
        coverageSnapshotHash: payload.coverageSnapshotHash,
        generatedAt: new Date(),
        aiExecutionId,
        stale: false,
      },
    );

    this.metrics.recordArtifactGenerated();
    this.logger.info({
      module: MODULE,
      message: 'research_artifact.generate.created',
      runId: payload.runId,
      artifactId: created.id,
      artifactType: payload.artifactType,
      coverageSnapshotHash: payload.coverageSnapshotHash,
      aiExecutionId,
    });

    return {
      kind: 'created',
      artifactId: created.id,
      aiExecutionId,
      coverageSnapshotHash: payload.coverageSnapshotHash,
    };
  }
}
