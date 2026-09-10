import {
  EMBED_MODEL_ID,
  EMBED_MODEL_VERSION,
  EMBED_DIMENSION,
} from '../../src/ai/policy/embed-policy.constants';
import type { IGatewayService } from '../../src/ai/gateway/gateway.port';
import {
  EMBED_BACKFILL_AUDIT_ACTION,
  EmbedBackfillAdminService,
} from '../../src/ai/embed/embed-backfill.admin';
import {
  EmbedBackfillPayloadError,
  parseEmbedBackfillRequest,
  toEmbedBackfillJobPayload,
} from '../../src/ai/embed/embed-backfill.payload';
import { EmbedBackfillService } from '../../src/ai/embed/embed-backfill.service';
import { EmbedMetrics } from '../../src/ai/embed/embed.metrics';
import { EmbedService } from '../../src/ai/embed/embed.service';
import type { AuditEventPort, QueueService } from '../../src/l0/ports';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { JobEnqueueService } from '../../src/platform/logging';
import type { PlatformLogger } from '../../src/platform/logging';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { deriveJobId } from '../../src/platform/queues/deterministic-job-id';
import { MemoryEmbeddingStore } from '../fixtures/memory-embedding-store';
import { MemoryExtractStore } from '../fixtures/memory-extract-store';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

const orgId = generateId();
const operatorId = generateId();
const projectId = generateId();
const documentId = generateId();
const batchId = 'backfill-2026-09';

function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orgId,
    operatorId,
    modelVersion: EMBED_MODEL_VERSION,
    batchId,
    scope: { projects: [projectId] },
    ...overrides,
  };
}

describe('DHB-53 embed-backfill payload (GAP-ADMIN-JOB-01)', () => {
  it('accepts an explicit project set and an allProjects scope', () => {
    expect(parseEmbedBackfillRequest(submission()).scope).toEqual({
      allProjects: false,
      projects: [projectId],
      documentIds: [],
    });
    expect(
      parseEmbedBackfillRequest(submission({ scope: { allProjects: true } })).scope,
    ).toEqual({ allProjects: true, projects: [], documentIds: [] });
    expect(
      parseEmbedBackfillRequest(submission({ scope: { documentIds: [documentId] } })).scope,
    ).toEqual({ allProjects: false, projects: [], documentIds: [documentId] });
  });

  it.each([
    ['scope_missing', submission({ scope: {} })],
    ['scope_missing', submission({ scope: undefined })],
    ['model_version_missing', submission({ modelVersion: '' })],
    ['batch_id_missing', submission({ batchId: undefined })],
    ['operator_missing', submission({ operatorId: undefined })],
    ['org_missing', submission({ orgId: '' })],
  ])('rejects a payload missing %s', (rejection, payload) => {
    expect(() => parseEmbedBackfillRequest(payload)).toThrow(EmbedBackfillPayloadError);
    try {
      parseEmbedBackfillRequest(payload);
    } catch (error) {
      expect((error as EmbedBackfillPayloadError).rejection).toBe(rejection);
    }
  });

  it('rejects allProjects combined with an explicit list', () => {
    for (const scope of [
      { allProjects: true, projects: [projectId] },
      { allProjects: true, documentIds: [documentId] },
    ]) {
      try {
        parseEmbedBackfillRequest(submission({ scope }));
        throw new Error('expected scope_conflict');
      } catch (error) {
        expect((error as EmbedBackfillPayloadError).rejection).toBe('scope_conflict');
      }
    }
  });
});

describe('DHB-53 embed-backfill admission (GAP-ADMIN-JOB-01)', () => {
  let audit: { append: jest.Mock };
  let queue: { getJobState: jest.Mock };
  let enqueue: { enqueue: jest.Mock };
  let admin: EmbedBackfillAdminService;

  function submit(payload: Record<string, unknown> = submission()) {
    return runWithCorrelationIdAsync('cor-backfill', () => admin.submit(payload));
  }

  beforeEach(() => {
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    queue = { getJobState: jest.fn().mockResolvedValue(null) };
    enqueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    admin = new EmbedBackfillAdminService(
      audit as unknown as AuditEventPort,
      queue as unknown as QueueService,
      enqueue as unknown as JobEnqueueService,
    );
  });

  it('writes exactly one audit row carrying operator, scope, version and batchId', async () => {
    await submit();

    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append.mock.calls[0]![0]).toMatchObject({
      actorType: 'user',
      actorId: operatorId,
      action: EMBED_BACKFILL_AUDIT_ACTION,
      correlationId: 'cor-backfill',
      scope: {
        operator: operatorId,
        modelVersion: EMBED_MODEL_VERSION,
        batchId,
        scope: { allProjects: false, projects: [projectId], documentIds: [] },
      },
    });
  });

  it('enqueues through the admission-gated enqueue path', async () => {
    await submit();

    expect(enqueue.enqueue).toHaveBeenCalledWith(
      'embed-backfill',
      expect.objectContaining({ orgId, modelVersion: EMBED_MODEL_VERSION, batchId }),
    );
  });

  it('is a no-op on the same (scope, modelVersion, batchId): no audit row, no enqueue', async () => {
    const jobId = deriveJobId(
      'embed-backfill',
      toEmbedBackfillJobPayload(parseEmbedBackfillRequest(submission())),
    );
    queue.getJobState.mockResolvedValue('waiting');

    await expect(submit()).resolves.toEqual({ kind: 'duplicate', jobId, batchId });
    expect(audit.append).not.toHaveBeenCalled();
    expect(enqueue.enqueue).not.toHaveBeenCalled();
  });

  it('writes no audit row for a rejected payload', async () => {
    await expect(submit(submission({ scope: {} }))).rejects.toThrow(
      EmbedBackfillPayloadError,
    );
    expect(audit.append).not.toHaveBeenCalled();
    expect(enqueue.enqueue).not.toHaveBeenCalled();
  });

  it('gives the same batch a stable job id across submissions', () => {
    const first = deriveJobId(
      'embed-backfill',
      toEmbedBackfillJobPayload(parseEmbedBackfillRequest(submission())),
    );
    const second = deriveJobId(
      'embed-backfill',
      toEmbedBackfillJobPayload(
        parseEmbedBackfillRequest(submission({ operatorId: generateId() })),
      ),
    );
    const otherBatch = deriveJobId(
      'embed-backfill',
      toEmbedBackfillJobPayload(
        parseEmbedBackfillRequest(submission({ batchId: 'other' })),
      ),
    );

    expect(second).toBe(first);
    expect(otherBatch).not.toBe(first);
  });
});

describe('DHB-53 embed-backfill run', () => {
  let store: MemoryEmbeddingStore;
  let gateway: { execute: jest.Mock };
  let metrics: EmbedMetrics;
  let backfill: EmbedBackfillService;

  beforeEach(() => {
    store = new MemoryEmbeddingStore();
    gateway = {
      execute: jest.fn().mockImplementation((_ctx, request) => ({
        capability: 'EMBED',
        vectors: request.texts.map(() =>
          Array.from({ length: EMBED_DIMENSION }, () => 0.02),
        ),
        inputType: 'document',
        metrics: { latencyMs: 4, tokensIn: 8, tokensOut: 0, costMicros: 80 },
        inputFingerprint: 'fp',
        promptVersion: EMBED_MODEL_VERSION,
        provider: 'voyage',
        model: EMBED_MODEL_ID,
        aiExecutionId: generateId(),
        method: 'llm',
      })),
    };
    metrics = new EmbedMetrics(stubLogger());
    for (let index = 0; index < 3; index += 1) {
      store.seedChunk({
        chunkId: `chunk-${index}`,
        orgId,
        projectId,
        documentId,
        documentVersionId: generateId(),
        contentHash: `hash-${index}`,
        text: `Chunk ${index}`,
      });
    }
    backfill = new EmbedBackfillService(
      store,
      new EmbedService(
        store,
        new MemoryExtractStore(),
        gateway as unknown as IGatewayService,
        metrics,
      ),
      metrics,
    );
  });

  function run(payload: Record<string, unknown>) {
    return runWithCorrelationIdAsync('cor-backfill', () => backfill.run({ payload }));
  }

  it('backfills a scoped project set and reports progress under the batchId', async () => {
    const outcome = await run(submission());

    expect(outcome).toEqual({ scanned: 3, written: 3, skipped: 0, batchId });
    expect(store.embeddings).toHaveLength(3);
    expect(metrics.snapshot().backfillProgress[batchId]).toBe(3);
  });

  it('may target a non-active model version — the one place that is permitted', async () => {
    const outcome = await run(submission({ modelVersion: 'embedding_v2' }));

    expect(outcome.written).toBe(3);
    expect(store.embeddings.every((row) => row.modelVersion === 'embedding_v2')).toBe(true);
  });

  it('is idempotent on (chunk, model version, content hash)', async () => {
    await run(submission());
    const replay = await run(submission());

    expect(replay).toMatchObject({ scanned: 3, written: 0, skipped: 3 });
    expect(store.embeddings).toHaveLength(3);
  });

  it('leaves the previous version intact when populating the next one', async () => {
    await run(submission());
    await run(submission({ modelVersion: 'embedding_v2' }));

    expect(store.embeddings.filter((row) => row.modelVersion === EMBED_MODEL_VERSION))
      .toHaveLength(3);
    expect(store.embeddings.filter((row) => row.modelVersion === 'embedding_v2'))
      .toHaveLength(3);
  });

  it('rejects an invalid payload at the job boundary', async () => {
    await expect(run(submission({ scope: { allProjects: true, projects: [projectId] } })))
      .rejects.toThrow(EmbedBackfillPayloadError);
    expect(store.embeddings).toHaveLength(0);
  });
});
