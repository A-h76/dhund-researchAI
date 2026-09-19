import { DomainError, ErrorCode } from '../../src/platform/errors';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { emptyResearchRunCoverage } from '../../src/l0/ports/research-run-coverage';
import { ExtractionMatrixMetrics } from '../../src/orchestration/extraction-matrix.metrics';
import { ExtractionMatrixService } from '../../src/orchestration/extraction-matrix.service';
import type { PlatformLogger } from '../../src/platform/logging';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';

describe('DHB-68 extraction matrix create + dispatch', () => {
  const orgId = generateId();
  const projectId = generateId();
  const userId = generateId();
  const documentId = generateId();

  function createService(options?: {
    readonly documentGet?: jest.Mock;
  }) {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as PlatformLogger;
    const metrics = new ExtractionMatrixMetrics(logger);
    const schemaId = generateId();
    const store = {
      createSchema: jest.fn().mockImplementation(async (input) => ({
        ...input,
        createdAt: new Date(),
      })),
      findSchema: jest.fn().mockResolvedValue({
        id: schemaId,
        projectId,
        name: 'matrix',
        columns: [{ key: 'dose', type: 'NUMBER' }],
        version: 1,
        createdAt: new Date(),
      }),
      createRunBundle: jest.fn().mockImplementation(async (input) => ({
        extractionRun: {
          id: input.extractionRun.id,
          runId: input.researchRun.id,
          schemaId: input.extractionRun.schemaId,
          schemaVersion: input.extractionRun.schemaVersion,
          documentIds: input.extractionRun.documentIds,
          state: 'pending',
          createdAt: new Date(),
        },
        cellCount: input.cells.length,
      })),
      findRunByResearchRunId: jest.fn().mockResolvedValue({
        id: generateId(),
        runId: 'run-1',
        schemaId,
        schemaVersion: 1,
        documentIds: [documentId],
        state: 'pending',
        createdAt: new Date(),
      }),
      updateRunState: jest.fn().mockImplementation(async (id, state) => ({
        id,
        runId: 'run-1',
        schemaId,
        schemaVersion: 1,
        documentIds: [documentId],
        state,
        createdAt: new Date(),
      })),
      listCells: jest.fn().mockResolvedValue([
        {
          id: generateId(),
          extractionRunId: 'er-1',
          documentId,
          columnKey: 'dose',
          value: null,
          evidenceLocator: null,
          aiExecutionId: null,
          confidence: null,
          method: 'deterministic',
          status: 'pending',
        },
      ]),
      countNonTerminalCells: jest.fn().mockResolvedValue(0),
    };
    const documents = {
      get:
        options?.documentGet ??
        jest.fn().mockResolvedValue({
          id: documentId,
          projectId,
          title: 'Doc',
          status: 'completed',
          createdAt: new Date(),
        }),
    };
    const enqueue = { enqueue: jest.fn().mockResolvedValue('tick-1') };
    const service = new ExtractionMatrixService(
      store as never,
      documents as never,
      enqueue as never,
      metrics,
      logger,
    );
    return { service, store, documents, enqueue, metrics, schemaId };
  }

  it('rejects untyped blob columns at schema creation', async () => {
    const { service } = createService();
    await expect(
      service.createSchema({
        projectId,
        name: 'bad',
        columns: [{ key: 'x', value: { nested: true } }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
  });

  it('creates exactly one ResearchRun with extraction_matrix preset when creating a run', async () => {
    await runWithCorrelationIdAsync('corr-create', async () => {
      const { service, store, enqueue } = createService();
      const result = await service.createRun({
        orgId,
        projectId,
        initiatedBy: userId,
        schemaId: generateId(),
        documentIds: [documentId],
        idempotencyKey: `key-${generateId()}`,
        correlationId: 'corr-create',
      });
      expect(result.cellCount).toBe(1);
      expect(store.createRunBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          researchRun: expect.objectContaining({
            orgId,
            projectId,
            initiatedBy: userId,
            coverage: emptyResearchRunCoverage(),
          }),
          cells: [expect.objectContaining({ documentId, columnKey: 'dose' })],
        }),
      );
      expect(enqueue.enqueue).toHaveBeenCalledWith(
        'research-run-tick',
        expect.objectContaining({ runId: result.researchRunId }),
      );
    });
  });

  it('coordinator dispatch enqueues extraction-cell per pending cell', async () => {
    await runWithCorrelationIdAsync('corr-dispatch', async () => {
      const { service, enqueue } = createService();
      const enqueued = await service.dispatchCellsForRun({
        id: 'run-1',
        orgId,
        projectId,
        preset: 'extraction_matrix',
        customDag: null,
        state: 'RUNNING',
        version: 1,
        reservedMicros: 1000n,
        consumedMicros: 0n,
        coverage: emptyResearchRunCoverage(),
        startedAt: new Date(),
        terminalAt: null,
      });
      expect(enqueued).toBe(1);
      expect(enqueue.enqueue).toHaveBeenCalledWith(
        'extraction-cell',
        expect.objectContaining({
          documentId,
          columnKey: 'dose',
          runId: 'run-1',
        }),
      );
    });
  });

  it('cross-project documentId is rejected as NotFound (404)', async () => {
    const { service } = createService({
      documentGet: jest
        .fn()
        .mockRejectedValue(new DomainError(ErrorCode.NotFound, { module: 'ingestion' })),
    });
    await runWithCorrelationIdAsync('corr-xproj', async () => {
      await expect(
        service.createRun({
          orgId,
          projectId,
          initiatedBy: userId,
          schemaId: generateId(),
          documentIds: [documentId],
          idempotencyKey: `key-${generateId()}`,
          correlationId: 'corr-xproj',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NotFound });
    });
  });
});
