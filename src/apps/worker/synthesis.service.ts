import { Inject, Injectable } from '@nestjs/common';
import type { IGatewayService } from '../../ai/gateway/gateway.port';
import { GatewayExecutionFailedError } from '../../ai/gateway/gateway-execution.errors';
import { GATEWAY_SERVICE } from '../../ai/tokens';
import { ClaimsMetrics } from '../../evidence/claims.metrics';
import { EvidenceJobError } from '../../evidence/evidence-job.errors';
import { stanceDistribution } from '../../evidence/stance-map';
import { SYNTHESIS_PROMPT_VERSION } from '../../evidence/synthesis.constants';
import {
  EVIDENCE_SPINE,
  EXTRACTION_MATRIX_STORE,
  type EvidenceRecord,
  type EvidenceSpinePort,
  type ExtractionMatrixStore,
} from '../../l0/ports';
import { generateId } from '../../platform/ids/uuid-v7';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { RuntimeRole } from '../../platform/runtime/role';

export interface SynthesisJobPayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly claimId: string;
  readonly promptVersion: string;
  readonly correlationId: string;
}

export type SynthesisJobOutcome =
  | {
      readonly kind: 'completed';
      readonly claimId: string;
      readonly aiExecutionId: string;
      readonly evidenceIds: readonly string[];
      readonly unresolvedShare: number;
    }
  | {
      readonly kind: 'idempotent';
      readonly claimId: string;
      readonly aiExecutionId: string;
      readonly evidenceIds: readonly string[];
      readonly unresolvedShare: number;
    };

@Injectable()
export class SynthesisService {
  constructor(
    @Inject(EVIDENCE_SPINE) private readonly spine: EvidenceSpinePort,
    @Inject(EXTRACTION_MATRIX_STORE) private readonly extraction: ExtractionMatrixStore,
    @Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService,
    private readonly metrics: ClaimsMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async execute(
    payload: SynthesisJobPayload,
    options?: { onHeartbeat?: () => Promise<void> },
  ): Promise<SynthesisJobOutcome> {
    if (payload.promptVersion !== SYNTHESIS_PROMPT_VERSION) {
      throw new EvidenceJobError(
        `Unsupported synthesis promptVersion "${payload.promptVersion}"`,
        false,
      );
    }

    const existing = await this.spine.findClaim(payload.claimId, payload.projectId);
    if (existing !== null) {
      const links = await this.spine.listClaimLinks(payload.claimId);
      if (links.length === 0) {
        throw new EvidenceJobError(
          'Synthesized claim rejected: evidence lineage is required',
          false,
        );
      }
      const stances = links.map((link) => link.stance);
      const distribution = stanceDistribution(stances);
      return {
        kind: 'idempotent',
        claimId: existing.id,
        aiExecutionId: existing.aiExecutionId ?? '',
        evidenceIds: links.map((link) => link.evidenceId),
        unresolvedShare: distribution.unresolvedShare,
      };
    }

    const evidence = await this.spine.listEvidenceForProject(payload.projectId);
    if (evidence.length === 0) {
      throw new EvidenceJobError(
        'Synthesized claim rejected: evidence lineage is required',
        false,
      );
    }

    const claims = await this.spine.listClaimsForProject(payload.projectId);
    const cellSummaries = await this.loadCellSummaries(payload.runId);
    const evidenceSummaries = buildEvidenceSummaries(evidence, claims, cellSummaries);

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
          capability: 'SYNTHESIS',
          evidenceSummaries,
        },
      );
    } catch (error) {
      this.metrics.recordSynthesisFailure();
      if (error instanceof GatewayExecutionFailedError) {
        throw new EvidenceJobError('Gateway synthesis execution failed', true, { cause: error });
      }
      throw new EvidenceJobError('Gateway synthesis execution failed', true, { cause: error });
    }

    if (gatewayResult.capability !== 'SYNTHESIS') {
      this.metrics.recordSynthesisFailure();
      throw new EvidenceJobError('Gateway returned a non-SYNTHESIS result', false);
    }

    const text = gatewayResult.text.trim();
    if (text.length === 0) {
      this.metrics.recordSynthesisFailure();
      throw new EvidenceJobError('Gateway synthesis returned empty text; no claim written', false);
    }

    const persisted = await this.spine.persistSynthesizedClaim({
      id: payload.claimId,
      projectId: payload.projectId,
      text,
      aiExecutionId: gatewayResult.aiExecutionId,
      evidenceLinks: evidence.map((row) => ({
        id: generateId(),
        evidenceId: row.id,
        stance: row.stance,
      })),
    });

    if (persisted.evidenceLinks.length === 0) {
      throw new EvidenceJobError(
        'Synthesized claim rejected: evidence lineage is required',
        false,
      );
    }

    const stances = persisted.evidenceLinks.map((link) => link.stance);
    const distribution = stanceDistribution(stances);
    this.metrics.recordSynthesis({
      costMicros: gatewayResult.metrics.costMicros,
      latencyMs: gatewayResult.metrics.latencyMs,
      unresolvedShare: distribution.unresolvedShare,
    });

    this.logger.info({
      module: 'evidence',
      message: 'synthesis.completed',
      runId: payload.runId,
      claimId: persisted.claim.id,
      aiExecutionId: gatewayResult.aiExecutionId,
      evidenceCount: persisted.evidenceLinks.length,
      unresolvedShare: distribution.unresolvedShare,
      costMicros: gatewayResult.metrics.costMicros,
      latencyMs: gatewayResult.metrics.latencyMs,
    });

    return {
      kind: 'completed',
      claimId: persisted.claim.id,
      aiExecutionId: gatewayResult.aiExecutionId,
      evidenceIds: persisted.evidenceLinks.map((link) => link.evidenceId),
      unresolvedShare: distribution.unresolvedShare,
    };
  }

  private async loadCellSummaries(runId: string): Promise<readonly string[]> {
    const extractionRun = await this.extraction.findRunByResearchRunId(runId);
    if (extractionRun === null) {
      return [];
    }
    const cells = await this.extraction.listCells(extractionRun.id);
    return cells
      .filter((cell) => cell.status === 'ok' && cell.value !== null)
      .map(
        (cell) =>
          `[extraction-cell column=${cell.columnKey} document=${cell.documentId}] ${stringifyCellValue(cell.value)}`,
      );
  }
}

function buildEvidenceSummaries(
  evidence: readonly EvidenceRecord[],
  claims: readonly { readonly text: string }[],
  cellSummaries: readonly string[],
): string[] {
  const stances = evidence.map((row) => row.stance);
  const distribution = stanceDistribution(stances);
  const summaries: string[] = [];

  if (distribution.supports > 0 && distribution.contradicts > 0) {
    summaries.push(
      'Conflicting evidence is present; opposing stances are preserved and not resolved away.',
    );
  }
  if (distribution.unresolved > 0) {
    summaries.push(
      `Unresolved share=${distribution.unresolvedShare.toFixed(4)}; unresolved stance is preserved uncoerced.`,
    );
  }

  for (const row of evidence) {
    summaries.push(formatEvidenceSummary(row));
  }
  for (const claim of claims) {
    summaries.push(`[existing-claim] ${claim.text}`);
  }
  for (const cell of cellSummaries) {
    summaries.push(cell);
  }
  return summaries;
}

function formatEvidenceSummary(row: EvidenceRecord): string {
  return `[evidence id=${row.id} stance=${row.stance}] ${row.text}`;
}

function stringifyCellValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
