import { DomainError, ErrorCode } from '../../src/platform/errors';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { ExtractionCellService } from '../../src/orchestration/extraction-cell.service';
import { ExtractionMatrixMetrics } from '../../src/orchestration/extraction-matrix.metrics';
import type { PlatformLogger } from '../../src/platform/logging';
import { RuntimeRole } from '../../src/platform/runtime/role';

describe('DHB-68 extraction cell evidence-grounding', () => {
  const orgId = generateId();
  const projectId = generateId();
  const runId = generateId();
  const extractionRunId = generateId();
  const documentId = generateId();
  const columnKey = 'dose';
  const cellId = generateId();
  const aiExecutionId = generateId();
  const evidenceId = generateId();

  function createService(options?: {
    readonly gatewayValue?: string;
    readonly documentStatus?: string;
    readonly locator?: {
      blockId: string;
      documentVersionId: string;
      page: number;
    } | null;
  }) {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as PlatformLogger;
    const metrics = new ExtractionMatrixMetrics(logger);
    const locator =
      options?.locator === null
        ? null
        : (options?.locator ?? {
            blockId: generateId(),
            documentVersionId: generateId(),
            page: 1,
          });

    const store = {
      findCell: jest.fn().mockResolvedValue({
        id: cellId,
        extractionRunId,
        documentId,
        columnKey,
        value: null,
        evidenceLocator: null,
        aiExecutionId: null,
        confidence: null,
        method: 'deterministic',
        status: 'pending',
      }),
      updateCell: jest.fn().mockImplementation(async (_id, patch) => ({
        id: cellId,
        extractionRunId,
        documentId,
        columnKey,
        value: patch.value ?? null,
        evidenceLocator: patch.evidenceLocator ?? null,
        aiExecutionId: patch.aiExecutionId ?? null,
        confidence: null,
        method: patch.method ?? 'deterministic',
        status: patch.status ?? 'pending',
      })),
    };

    const documents = {
      get: jest.fn().mockResolvedValue({
        id: documentId,
        projectId,
        title: 'Doc',
        status: options?.documentStatus ?? 'completed',
        createdAt: new Date(),
      }),
    };

    const matrix = {
      loadRunContext: jest.fn().mockResolvedValue({
        extractionRun: {
          id: extractionRunId,
          runId,
          schemaId: generateId(),
          schemaVersion: 1,
          documentIds: [documentId],
          state: 'running',
          createdAt: new Date(),
        },
        columns: [
          {
            key: columnKey,
            type: 'NUMBER',
            label: 'Dose',
          },
        ],
      }),
      finalizeExtractionRunIfReady: jest.fn().mockResolvedValue(undefined),
    };

    const retrieval = {
      retrieve: jest.fn().mockResolvedValue({
        hits: [
          {
            chunkId: generateId(),
            projectId,
            documentId,
            text: 'dose is 10 mg',
            rrfScore: 1,
            rerankScore: 1,
            vectorScore: 1,
            ftsScore: null,
            sourceId: generateId(),
            evidenceRefs: [evidenceId],
            qualityAnnotation: 'body_grounded',
          },
        ],
        trace: { id: generateId(), fingerprint: 'fp-extract' },
        understoodQuery: 'Dose',
        vectorHits: [],
        ftsHits: [],
        timings: {
          queryUnderstandingMs: 0,
          vectorMs: 0,
          ftsMs: 0,
          rrfMs: 0,
          rerankMs: 0,
        },
        efSearch: 40,
        limit: 12,
        rerankMethod: 'deterministic',
        fallbacksUsed: [],
      }),
    };

    const evidence = {
      findEvidence: jest.fn().mockResolvedValue(
        locator === null
          ? null
          : {
              id: evidenceId,
              projectId,
              sourceId: generateId(),
              chunkId: generateId(),
              locator,
              text: 'dose is 10 mg',
              stance: 'neutral',
              extractionMethod: 'llm',
              aiExecutionId,
              type: 'body_grounded',
            },
      ),
    };

    const gateway = {
      execute: jest.fn().mockResolvedValue({
        capability: 'EXTRACT_CELL',
        value: options?.gatewayValue ?? '10',
        aiExecutionId,
        method: 'llm',
        metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 5 },
      }),
    };

    const enqueue = { enqueue: jest.fn().mockResolvedValue('tick-job') };

    const service = new ExtractionCellService(
      store as never,
      retrieval as never,
      evidence as never,
      gateway as never,
      documents as never,
      matrix as never,
      enqueue as never,
      metrics,
      logger,
    );

    return { service, store, gateway, retrieval, metrics, documents };
  }

  const payload = {
    orgId,
    projectId,
    runId,
    extractionRunId,
    documentId,
    columnKey,
    correlationId: 'corr-cell',
  };

  it('persists ok cells with locator and aiExecutionId (provenance complete)', async () => {
    const { service, store, retrieval } = createService({ gatewayValue: '10' });
    const outcome = await service.execute(payload);
    expect(outcome.kind).toBe('ok');
    expect(store.updateCell).toHaveBeenCalledWith(
      cellId,
      expect.objectContaining({
        status: 'ok',
        value: 10,
        aiExecutionId,
        method: 'llm',
        evidenceLocator: expect.objectContaining({
          blockId: expect.any(String),
          documentVersionId: expect.any(String),
          page: 1,
        }),
      }),
    );
    expect(retrieval.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        runtimeRole: RuntimeRole.Worker,
      }),
    );
  });

  it('records failed cells with no invented value on type mismatch', async () => {
    const { service, store, metrics } = createService({
      gatewayValue: '"not-a-number"',
    });
    const outcome = await service.execute(payload);
    expect(outcome.kind).toBe('failed');
    expect(store.updateCell).toHaveBeenCalledWith(
      cellId,
      expect.objectContaining({
        status: 'failed',
        value: null,
      }),
    );
    expect(metrics.snapshot().typeMismatchRejections).toBe(1);
  });

  it('refuses partial documents with document_not_ready', async () => {
    const { service, store } = createService({ documentStatus: 'partial' });
    await expect(service.execute(payload)).rejects.toMatchObject({
      code: ErrorCode.DocumentNotReady,
    });
    expect(store.updateCell).toHaveBeenCalledWith(
      cellId,
      expect.objectContaining({ status: 'failed', value: null }),
    );
  });

  it('rejects cross-project document access as NotFound', async () => {
    const { service, documents } = createService();
    documents.get.mockRejectedValue(
      new DomainError(ErrorCode.NotFound, { module: 'ingestion' }),
    );
    await expect(service.execute(payload)).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
  });
});
