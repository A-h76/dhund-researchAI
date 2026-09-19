import { Inject, Injectable } from '@nestjs/common';
import type { IGatewayService } from '../ai/gateway/gateway.port';
import { GatewayExecutionFailedError } from '../ai/gateway/gateway-execution.errors';
import { GATEWAY_SERVICE } from '../ai/tokens';
import { assertDocumentReady } from '../ingestion/document-readiness';
import { DocumentsRepository } from '../ingestion/documents.repository';
import {
  EXTRACTION_MATRIX_STORE,
  EVIDENCE_SPINE,
  type EvidenceSpinePort,
  type ExtractionMatrixStore,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { JobEnqueueService } from '../platform/logging';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import { RuntimeRole } from '../platform/runtime/role';
import {
  RETRIEVAL_SERVICE,
  type IRetrievalService,
} from '../retrieval/retrieval.port';
import { assembleBatchContext } from './extraction-batch-context';
import {
  assertExtractionValueMatchesType,
  parseExtractionCellOutput,
  type ExtractionColumnDefinition,
} from './extraction-column-types';
import { ExtractionMatrixMetrics } from './extraction-matrix.metrics';
import { ExtractionMatrixService } from './extraction-matrix.service';

const MODULE = 'orchestration';
const EXTRACTION_RETRIEVAL_K = 12;

export interface ExtractionCellJobPayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly extractionRunId: string;
  readonly documentId: string;
  readonly columnKey: string;
  readonly correlationId: string;
}

export type ExtractionCellOutcome =
  | { readonly kind: 'idempotent'; readonly status: 'ok' | 'failed' | 'skipped' }
  | {
      readonly kind: 'ok';
      readonly cellId: string;
      readonly aiExecutionId: string;
      readonly retrievalTraceId: string;
    }
  | { readonly kind: 'failed'; readonly cellId: string; readonly reason: string };

@Injectable()
export class ExtractionCellService {
  constructor(
    @Inject(EXTRACTION_MATRIX_STORE) private readonly store: ExtractionMatrixStore,
    @Inject(RETRIEVAL_SERVICE) private readonly retrieval: IRetrievalService,
    @Inject(EVIDENCE_SPINE) private readonly evidence: EvidenceSpinePort,
    @Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService,
    private readonly documents: DocumentsRepository,
    private readonly matrix: ExtractionMatrixService,
    private readonly enqueue: JobEnqueueService,
    private readonly metrics: ExtractionMatrixMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async execute(payload: ExtractionCellJobPayload): Promise<ExtractionCellOutcome> {
    const cell = await this.store.findCell({
      extractionRunId: payload.extractionRunId,
      documentId: payload.documentId,
      columnKey: payload.columnKey,
    });
    if (cell === null) {
      throw new DomainError(ErrorCode.NotFound, {
        module: MODULE,
        userMessage: 'Extraction cell not found.',
      });
    }

    if (cell.status === 'ok' || cell.status === 'failed' || cell.status === 'skipped') {
      return { kind: 'idempotent', status: cell.status };
    }

    const { columns } = await this.matrix.loadRunContext({
      projectId: payload.projectId,
      extractionRunId: payload.extractionRunId,
    });
    const column = columns.find((entry) => entry.key === payload.columnKey);
    if (column === undefined) {
      await this.markFailed(cell.id, payload, 'unknown_column');
      return { kind: 'failed', cellId: cell.id, reason: 'unknown_column' };
    }

    try {
      const document = await this.documents.get(
        { projectId: payload.projectId },
        payload.documentId,
      );
      assertDocumentReady(String(document.status));
    } catch (error) {
      if (error instanceof DomainError && error.code === ErrorCode.DocumentNotReady) {
        await this.markFailed(cell.id, payload, 'document_not_ready');
        throw error;
      }
      if (error instanceof DomainError && error.code === ErrorCode.NotFound) {
        await this.markFailed(cell.id, payload, 'cross_project_or_missing');
        throw error;
      }
      throw error;
    }

    await this.store.updateCell(cell.id, { status: 'running' });

    const retrieval = await this.retrieval.retrieve({
      orgId: payload.orgId,
      projectId: payload.projectId,
      query: column.label ?? column.key,
      k: EXTRACTION_RETRIEVAL_K,
      correlationId: payload.correlationId,
      runtimeRole: RuntimeRole.Worker,
    });

    const context = assembleBatchContext(retrieval.hits, {
      documentIds: [payload.documentId],
      retrievalTraceId: retrieval.trace.id,
      retrievalFingerprint: retrieval.trace.fingerprint,
    });

    // Provenance: every ok cell needs a locator from grounded evidence.
    const locator = await this.resolveLocator(payload.projectId, context.evidenceIds);
    if (locator === null) {
      await this.markFailed(cell.id, payload, 'missing_locator');
      return { kind: 'failed', cellId: cell.id, reason: 'missing_locator' };
    }

    let aiExecutionId: string;
    let rawValue: string;
    let costMicros = 0;
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
          capability: 'EXTRACT_CELL',
          columnKey: column.key,
          documentContent: context.documentContent,
        },
      );
      if (result.capability !== 'EXTRACT_CELL') {
        throw new DomainError(ErrorCode.ValidationError, {
          module: MODULE,
          userMessage: 'Gateway returned a non-EXTRACT_CELL result',
        });
      }
      aiExecutionId = result.aiExecutionId;
      rawValue = result.value;
      costMicros = result.metrics.costMicros;
    } catch (error) {
      await this.markFailed(cell.id, payload, 'gateway_failed');
      if (error instanceof GatewayExecutionFailedError || error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(ErrorCode.UpstreamUnavailable, {
        module: MODULE,
        userMessage: 'Extraction cell generation failed; no invented value written.',
        cause: error instanceof Error ? error : undefined,
      });
    }

    let typedValue: unknown;
    try {
      typedValue = parseExtractionCellOutput(column, rawValue);
      assertExtractionValueMatchesType(column, typedValue);
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === ErrorCode.ExtractionValueTypeMismatch
      ) {
        this.metrics.recordTypeMismatch();
        // Failure honesty: record failed with no plausible/invented value.
        await this.markFailed(cell.id, payload, 'type_mismatch', aiExecutionId);
        return { kind: 'failed', cellId: cell.id, reason: 'type_mismatch' };
      }
      throw error;
    }

    // Persist only a complete provenance row — locator + aiExecutionId required.
    const updated = await this.store.updateCell(cell.id, {
      status: 'ok',
      value: typedValue,
      evidenceLocator: locator,
      aiExecutionId,
      method: 'llm',
    });

    if (updated.evidenceLocator === null || updated.aiExecutionId === null) {
      await this.markFailed(cell.id, payload, 'incomplete_provenance');
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'Extraction cell rejected: locator and aiExecutionId are required.',
      });
    }

    this.metrics.recordCellOutcome('ok');
    this.metrics.recordCellCost(costMicros);
    this.logger.info({
      module: MODULE,
      message: 'extraction_cell.ok',
      extractionRunId: payload.extractionRunId,
      documentId: payload.documentId,
      columnKey: payload.columnKey,
      aiExecutionId,
      retrievalTraceId: context.retrievalTraceId,
      costMicros,
    });

    await this.afterCellSettled(payload);
    return {
      kind: 'ok',
      cellId: cell.id,
      aiExecutionId,
      retrievalTraceId: context.retrievalTraceId,
    };
  }

  private async resolveLocator(
    projectId: string,
    evidenceIds: readonly string[],
  ): Promise<{
    readonly blockId: string;
    readonly documentVersionId: string;
    readonly page: number;
  } | null> {
    for (const evidenceId of evidenceIds) {
      const evidence = await this.evidence.findEvidence(evidenceId, projectId);
      if (evidence !== null) {
        return {
          blockId: evidence.locator.blockId,
          documentVersionId: evidence.locator.documentVersionId,
          page: evidence.locator.page,
        };
      }
    }
    return null;
  }

  private async markFailed(
    cellId: string,
    payload: ExtractionCellJobPayload,
    reason: string,
    aiExecutionId?: string,
  ): Promise<void> {
    // Never invent a value on failure — clear value, keep method deterministic unless we have execution id.
    await this.store.updateCell(cellId, {
      status: 'failed',
      value: null,
      evidenceLocator: null,
      ...(aiExecutionId !== undefined
        ? { aiExecutionId, method: 'llm' as const }
        : { method: 'deterministic' as const }),
    });
    this.metrics.recordCellOutcome('failed');
    this.logger.info({
      module: MODULE,
      message: 'extraction_cell.failed',
      extractionRunId: payload.extractionRunId,
      documentId: payload.documentId,
      columnKey: payload.columnKey,
      reason,
    });
    await this.afterCellSettled(payload);
  }

  private async afterCellSettled(payload: ExtractionCellJobPayload): Promise<void> {
    await this.matrix.finalizeExtractionRunIfReady(payload.runId);
    await this.enqueue.enqueue('research-run-tick', {
      orgId: payload.orgId,
      projectId: payload.projectId,
      runId: payload.runId,
    });
  }
}

// Keep column type import used for documentation / future typed returns.
export type { ExtractionColumnDefinition };
