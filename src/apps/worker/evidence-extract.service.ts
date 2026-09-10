import { Inject, Injectable } from '@nestjs/common';
import type { IGatewayService } from '../../ai/gateway/gateway.port';
import { GatewayExecutionFailedError } from '../../ai/gateway/gateway-execution.errors';
import type {
  EvidenceExtractCandidate,
  EvidenceLocatorCatalogEntry,
} from '../../ai/gateway/gateway.types';
import { GATEWAY_SERVICE } from '../../ai/tokens';
import { EVIDENCE_EXTRACT_STEP_TYPE } from '../../evidence/extract.constants';
import { EvidenceJobError } from '../../evidence/evidence-job.errors';
import { EvidenceMetrics } from '../../evidence/evidence.metrics';
import { EvidenceLocatorError, EvidenceLocatorResolver } from '../../ingestion/extract/evidence-locator.resolver';
import {
  DOCUMENT_INGESTION_STORE,
  type DocumentBlockRecord,
  type DocumentIngestionStore,
} from '../../l0/ports/document-ingestion.port';
import {
  EVIDENCE_SPINE,
  type EvidenceSpinePort,
  type PersistExtractedEvidenceInput,
} from '../../l0/ports/evidence-spine.port';
import { generateId } from '../../platform/ids/uuid-v7';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { RuntimeRole } from '../../platform/runtime/role';

export interface EvidenceExtractJobPayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly stepType: string;
  readonly inputFingerprint: string;
  readonly stepVersion: string;
  readonly sourceId: string;
  readonly documentVersionId: string;
  readonly correlationId: string;
}

export type EvidenceExtractOutcome =
  | {
      readonly kind: 'completed';
      readonly aiExecutionId: string;
      readonly evidenceIds: readonly string[];
      readonly omittedLocatorCount: number;
    }
  | {
      readonly kind: 'idempotent';
      readonly aiExecutionId: string;
      readonly evidenceIds: readonly string[];
      readonly omittedLocatorCount: number;
    };

@Injectable()
export class EvidenceExtractService {
  constructor(
    @Inject(EVIDENCE_SPINE) private readonly spine: EvidenceSpinePort,
    @Inject(DOCUMENT_INGESTION_STORE) private readonly documents: DocumentIngestionStore,
    @Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService,
    private readonly locators: EvidenceLocatorResolver,
    private readonly metrics: EvidenceMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async execute(
    payload: EvidenceExtractJobPayload,
    options?: { onHeartbeat?: () => Promise<void> },
  ): Promise<EvidenceExtractOutcome> {
    if (payload.stepType !== EVIDENCE_EXTRACT_STEP_TYPE) {
      return {
        kind: 'idempotent',
        aiExecutionId: '',
        evidenceIds: [],
        omittedLocatorCount: 0,
      };
    }

    const existing = await this.spine.findExtractionSet(payload.stepId);
    if (existing !== null) {
      return {
        kind: 'idempotent',
        aiExecutionId: existing.aiExecutionId,
        evidenceIds: existing.evidenceIds,
        omittedLocatorCount: existing.omittedLocatorCount,
      };
    }

    const source = await this.spine.findSource(payload.sourceId);
    if (source === null || source.projectId !== payload.projectId) {
      this.metrics.recordExtractionFailure();
      throw new EvidenceJobError(`Source "${payload.sourceId}" was not found in project`, false);
    }

    const version = await this.documents.getVersionWithDocument(payload.documentVersionId);
    if (version === null || version.document.projectId !== payload.projectId) {
      this.metrics.recordExtractionFailure();
      throw new EvidenceJobError(
        `Document version "${payload.documentVersionId}" was not found`,
        false,
      );
    }

    const blocks = await this.documents.listBlocks(payload.documentVersionId);
    const catalog: EvidenceLocatorCatalogEntry[] = [];
    for (const block of blocks) {
      const chunk = await this.spine.findChunkForBlock({
        projectId: payload.projectId,
        documentVersionId: payload.documentVersionId,
        blockId: block.id,
      });
      catalog.push({
        documentVersionId: payload.documentVersionId,
        blockId: block.id,
        page: block.page,
        ...(chunk !== null ? { chunkId: chunk.id } : {}),
      });
    }

    const documentContent = blocks.map((block) => block.text).join('\n\n');
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
          capability: 'EVIDENCE_EXTRACT',
          documentContent,
          locatorCatalog: catalog,
        },
      );
    } catch (error) {
      this.metrics.recordExtractionFailure();
      if (error instanceof GatewayExecutionFailedError) {
        throw new EvidenceJobError('Gateway evidence-extract execution failed', true, {
          cause: error,
        });
      }
      throw new EvidenceJobError('Gateway evidence-extract execution failed', true, {
        cause: error,
      });
    }

    if (gatewayResult.capability !== 'EVIDENCE_EXTRACT') {
      this.metrics.recordExtractionFailure();
      throw new EvidenceJobError('Gateway returned a non-EVIDENCE_EXTRACT result', false);
    }

    await options?.onHeartbeat?.();

    const accepted: PersistExtractedEvidenceInput[] = [];
    let omittedLocatorCount = 0;

    for (const candidate of gatewayResult.candidates) {
      const prepared = await this.prepareCandidate(
        payload,
        source.projectId,
        candidate,
        gatewayResult.aiExecutionId,
      );
      if (prepared === null) {
        omittedLocatorCount += 1;
        continue;
      }
      accepted.push(prepared);
    }

    const persisted = await this.spine.persistExtractionSet({
      stepId: payload.stepId,
      runId: payload.runId,
      inputFingerprint: payload.inputFingerprint,
      correlationId: payload.correlationId,
      aiExecutionId: gatewayResult.aiExecutionId,
      omittedLocatorCount,
      evidence: accepted,
    });

    this.metrics.recordExtraction({
      evidenceCount: persisted.evidenceIds.length,
      omittedLocatorCount,
      costMicros: gatewayResult.metrics.costMicros,
    });

    this.logger.info({
      module: 'evidence',
      message: 'evidence.extracted',
      runId: payload.runId,
      stepId: payload.stepId,
      aiExecutionId: gatewayResult.aiExecutionId,
      evidenceCount: persisted.evidenceIds.length,
      omittedLocatorCount,
      costMicros: gatewayResult.metrics.costMicros,
    });

    return {
      kind: 'completed',
      aiExecutionId: persisted.aiExecutionId,
      evidenceIds: persisted.evidenceIds,
      omittedLocatorCount: persisted.omittedLocatorCount,
    };
  }

  private async prepareCandidate(
    payload: EvidenceExtractJobPayload,
    projectId: string,
    candidate: EvidenceExtractCandidate,
    aiExecutionId: string,
  ): Promise<PersistExtractedEvidenceInput | null> {
    if (candidate.locator === undefined) {
      return null;
    }

    let block: DocumentBlockRecord;
    try {
      block = await this.locators.resolve({
        documentVersionId: candidate.locator.documentVersionId,
        blockId: candidate.locator.blockId,
        page: candidate.locator.page,
      });
    } catch (error) {
      if (error instanceof EvidenceLocatorError) {
        return null;
      }
      throw error;
    }

    if (block.documentVersionId !== payload.documentVersionId) {
      return null;
    }

    const quote = candidate.text.trim();
    if (quote.length === 0 || !block.text.includes(quote)) {
      return null;
    }

    const type = candidate.type === 'metadata_only' ? 'metadata_only' : 'body_grounded';
    let chunkId: string | null = candidate.chunkId ?? null;

    if (type === 'body_grounded') {
      if (chunkId !== null) {
        const scoped = await this.spine.findChunkInProject(chunkId, projectId);
        if (scoped === null) {
          return null;
        }
      } else {
        const matched = await this.spine.findChunkForBlock({
          projectId,
          documentVersionId: payload.documentVersionId,
          blockId: block.id,
        });
        chunkId = matched?.id ?? null;
      }
      if (chunkId === null) {
        return null;
      }
    } else {
      chunkId = null;
    }

    return {
      id: generateId(),
      projectId,
      sourceId: payload.sourceId,
      chunkId,
      locator: {
        documentVersionId: candidate.locator.documentVersionId,
        blockId: candidate.locator.blockId,
        page: candidate.locator.page,
      },
      text: quote,
      type,
      aiExecutionId,
    };
  }
}
