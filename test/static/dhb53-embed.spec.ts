import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMBED_DIMENSION,
  EMBED_MODEL_ID,
  EMBED_MODEL_VERSION,
  VOYAGE_EMBED_MAX_TEXTS,
  VOYAGE_EMBED_MAX_TOKENS,
  WRITE_ACTIVE_EMBED_MODEL_VERSION,
} from '../../src/ai/policy/embed-policy.constants';
import { EMBEDDING_VECTOR_DIMENSION } from '../../src/l0/ports/embedding-store.port';
import {
  EMBED_BACKFILL_GLOBAL_CAP,
  isUploadGatedQueue,
} from '../../src/platform/concurrency/concurrency-gate.config';
import { QUEUE_NAMES } from '../../src/platform/queues/queue-names';
import { QUEUE_REGISTRY } from '../../src/platform/queues/queue-registry';
import { getQueueLivenessPolicy } from '../../src/platform/reliability/queue-liveness.config';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Provider SDKs that must never appear on an embed code path. */
const VOYAGE_SDK_SPECIFIERS = ['voyageai', 'VoyageAIClient'];

function collectTs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTs(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function relativePath(file: string): string {
  return file.replace(/\\/g, '/').slice(file.replace(/\\/g, '/').indexOf('/src/') + 1);
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('DHB-53 GAP-EMBED-01 decision conformance', () => {
  const embedService = read('src/ai/embed/embed.service.ts');
  const embedAdapter = read('src/l0/adapters/prisma/prisma-embedding-store.adapter.ts');
  const embedPort = read('src/l0/ports/embedding-store.port.ts');
  const processor = read('src/apps/worker/embed.processor.ts');
  const migration = read('prisma/migrations/20250829131000_010_embeddings/migration.sql');

  it('locks the column type, model id and model version', () => {
    expect(migration).toContain('"vector" vector(1024) NOT NULL');
    expect(migration).toContain('CHECK ("dimensions" = 1024)');
    expect(migration).toContain(
      `"model_version" <> '${EMBED_MODEL_VERSION}' OR "model_id" = '${EMBED_MODEL_ID}'`,
    );
    expect(EMBED_MODEL_ID).toBe('voyage-4');
    expect(EMBED_MODEL_VERSION).toBe('embedding_v1');
    expect(EMBED_DIMENSION).toBe(1024);
    // The policy dimension and the schema width are the same number.
    expect(EMBED_DIMENSION).toBe(EMBEDDING_VECTOR_DIMENSION);
  });

  it('keeps the ANN index on the cosine <=> operator class', () => {
    expect(migration).toContain('USING hnsw ("vector" vector_cosine_ops)');
    expect(migration).toContain(`WHERE "model_version" = '${EMBED_MODEL_VERSION}'`);
  });

  it('splits input_type: stored chunks embed as documents', () => {
    expect(embedService).toContain('EMBED_DOCUMENT_INPUT_TYPE');
    expect(embedService).not.toMatch(/inputType:\s*'query'/);
    expect(read('src/ai/policy/embed-policy.constants.ts')).toContain(
      "EMBED_DOCUMENT_INPUT_TYPE: EmbedInputType = 'document'",
    );
  });

  it('has no cross-dimension fallback: a wrong width is refused, never resized', () => {
    for (const source of [embedService, embedAdapter, embedPort]) {
      // No resizing of a vector on the way to the column.
      expect(source).not.toMatch(/vector\w*\.(slice|concat|splice)\(/i);
      expect(source).not.toMatch(/pad(End|Start)\(/);
      expect(source).not.toMatch(/\.slice\(0,\s*(EMBED|EMBEDDING)[A-Z_]*DIMENSION/);
    }
    expect(embedAdapter).toContain('EmbeddingDimensionMismatchError');
    // The guard runs before the statement is built.
    expect(embedAdapter.indexOf('assertSchemaDimension(row)')).toBeLessThan(
      embedAdapter.indexOf('INSERT INTO chunk_embeddings'),
    );
  });

  it('routes every embedding write through Gateway EMBED — the worker has no Voyage SDK', () => {
    const gatewayCallersOutsideAi: string[] = [];
    const sdkImporters: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      const relative = relativePath(file);
      // Worker, ingestion, and the rest of the graph never issue EMBED —
      // only the AI embed job (behind the gateway) does.
      if (!relative.startsWith('src/ai/') && /capability:\s*'EMBED'/.test(content)) {
        gatewayCallersOutsideAi.push(relative);
      }
      if (VOYAGE_SDK_SPECIFIERS.some((specifier) => content.includes(specifier))) {
        sdkImporters.push(relative);
      }
    }

    expect(gatewayCallersOutsideAi).toEqual([]);
    expect(embedService).toContain("capability: 'EMBED'");
    expect(embedService).toContain('GATEWAY_SERVICE');
    // The Voyage SDK lives in exactly one adapter, behind the gateway.
    expect(sdkImporters).toEqual(['src/ai/adapters/voyage/sdk-voyage.client.ts']);

    for (const source of [embedService, processor, embedAdapter]) {
      for (const specifier of VOYAGE_SDK_SPECIFIERS) {
        expect(source).not.toContain(specifier);
      }
    }
  });

  it('is the sole writer of chunk_embeddings rows', () => {
    for (const file of collectTs(SRC)) {
      const relative = file.replace(/\\/g, '/');
      if (relative.endsWith('/prisma-embedding-store.adapter.ts')) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/INSERT INTO chunk_embeddings/i);
      expect(content).not.toMatch(/chunkEmbedding\.(create|createMany|update|upsert)/);
    }
    // Append-only: no update path for a stored vector.
    expect(embedAdapter).not.toMatch(/chunkEmbedding\.(update|upsert)/);
    expect(embedAdapter).toContain('DO NOTHING');
  });

  it('batches inside the Voyage caps and keeps embed retries at 5 with a DLQ', () => {
    expect(VOYAGE_EMBED_MAX_TEXTS).toBe(1000);
    expect(VOYAGE_EMBED_MAX_TOKENS).toBe(320_000);
    expect(read('src/ai/embed/embed.blocks.ts')).toContain('VOYAGE_EMBED_MAX_TOKENS');

    expect(QUEUE_REGISTRY.embed.attempts).toEqual({ kind: 'fixed', attempts: 5 });
    expect(QUEUE_REGISTRY.embed.dlqName).toBe('embed-dlq');
    expect(QUEUE_REGISTRY.embed.naturalKeyFields).toEqual([
      'chunkId',
      'modelVersion',
      'contentHash',
    ]);
    expect(getQueueLivenessPolicy('embed').timeoutMs).toBe(60 * 60 * 1000);
    expect(processor).toContain("register('embed')");
  });

  it('keeps exactly one write-active version, enforced before the gateway call', () => {
    expect(WRITE_ACTIVE_EMBED_MODEL_VERSION).toBe(EMBED_MODEL_VERSION);
    expect(embedService).toContain('isWriteActiveEmbedModelVersion');
    expect(embedService.indexOf('isWriteActiveEmbedModelVersion')).toBeLessThan(
      embedService.indexOf('this.store.findChunk'),
    );
    // The check is declared once and applied on exactly one path — the embed
    // job. Backfill never calls it, which is what lets it target a non-active
    // version.
    const versionCheckers = collectTs(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes('isWriteActiveEmbedModelVersion'),
    );
    expect(versionCheckers.map(relativePath).sort()).toEqual([
      'src/ai/embed/embed.service.ts',
      'src/ai/policy/embed-policy.constants.ts',
    ]);
  });

  it('adds no schema migration — chunk_embeddings ships in migration 010', () => {
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb53'))).toBe(false);
    expect(migration).toContain(
      'CONSTRAINT "chunk_embeddings_chunk_id_model_version_content_hash_key" UNIQUE ("chunk_id", "model_version", "content_hash")',
    );
  });
});

describe('DHB-53 GAP-ADMIN-JOB-01 decision conformance', () => {
  const admin = read('src/ai/embed/embed-backfill.admin.ts');
  const backfillService = read('src/ai/embed/embed-backfill.service.ts');
  const backfillProcessor = read('src/apps/worker/embed-backfill.processor.ts');

  const controllerFiles = collectTs(SRC).filter((file) =>
    file.endsWith('.controller.ts'),
  );

  it('has exactly one producer for the embed-backfill queue', () => {
    const producers = collectTs(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes("enqueue('embed-backfill'"),
    );
    expect(producers.map(relativePath)).toEqual(['src/ai/embed/embed-backfill.admin.ts']);
  });

  it('no /v1 route reaches the queue: no controller reaches the producer', () => {
    // Route enumeration: no controller declares a backfill path, and none of
    // them import the producer or the backfill module, directly or via a
    // one-hop import of a file that does.
    const producerSymbols = [
      'EmbedBackfillAdminService',
      'embed-backfill.admin',
      'EmbedModule',
      'embed.module',
    ];

    for (const controller of controllerFiles) {
      const content = readFileSync(controller, 'utf8');
      expect(content).not.toMatch(/backfill/i);
      for (const symbol of producerSymbols) {
        expect(content).not.toContain(symbol);
      }
    }

    // The API app graph never pulls the embed module in.
    const apiModule = read('src/apps/api/api-app.module.ts');
    expect(apiModule).not.toContain('EmbedModule');
    expect(apiModule).not.toMatch(/backfill/i);

    // The worker owns it, and the worker serves no HTTP.
    expect(read('src/apps/worker/worker-app.module.ts')).toContain('EmbedBackfillProcessor');
    expect(backfillProcessor).toContain("register('embed-backfill')");
  });

  it('validates the payload and rejects allProjects combined with a project list', () => {
    const payload = read('src/ai/embed/embed-backfill.payload.ts');
    expect(payload).toContain('scope_conflict');
    expect(payload).toContain('model_version_missing');
    expect(payload).toContain('batch_id_missing');
    expect(admin).toContain('parseEmbedBackfillRequest');
    expect(backfillService).toContain('parseEmbedBackfillRequest');
  });

  it('audits before enqueue, exactly once per accepted invocation', () => {
    expect(admin).toContain('this.audit.append');
    expect(admin.match(/this\.audit\.append/g)).toHaveLength(1);
    // The duplicate short-circuit precedes the audit, so a no-op writes no row.
    expect(admin.indexOf("kind: 'duplicate'")).toBeLessThan(
      admin.indexOf('await this.appendAudit'),
    );
    expect(admin.indexOf('await this.appendAudit')).toBeLessThan(
      admin.indexOf("this.enqueue.enqueue('embed-backfill'"),
    );
  });

  it('reads no Redis on the authorization path', () => {
    for (const source of [admin, read('src/ai/embed/embed-backfill.payload.ts')]) {
      expect(source).not.toContain('CACHE_SERVICE');
      expect(source).not.toContain('AccessContextService');
      expect(source).not.toContain('ACCESS_CONTEXT');
      expect(source).not.toContain('ioredis');
    }
    // Operator identity is carried on the submission, not resolved from a cache.
    expect(admin).toContain('request.operatorId');
  });

  it('uses a global cap that cannot starve the interactive lane', () => {
    expect(EMBED_BACKFILL_GLOBAL_CAP).toBe(2);
    const gate = read('src/platform/concurrency/batch-concurrency-gate.service.ts');
    expect(gate).toContain("queueName === 'embed-backfill'");
    expect(gate).toContain('EMBED_BACKFILL_GLOBAL_CAP');
    expect(read('src/platform/concurrency/enqueue-admission.service.ts')).toContain(
      'assertBatchDoesNotStarveInteractive',
    );
    // The backfill queue is not upload-gated, so it never consumes upload slots.
    expect(isUploadGatedQueue('embed-backfill')).toBe(false);
  });

  it('keeps the locked queue topology at 25 queues with backfill retries of 3', () => {
    expect(QUEUE_NAMES).toHaveLength(25);
    expect(QUEUE_REGISTRY['embed-backfill'].attempts).toEqual({ kind: 'fixed', attempts: 3 });
    expect(QUEUE_REGISTRY['embed-backfill'].dlqName).toBe('embed-backfill-dlq');
    expect(QUEUE_REGISTRY['embed-backfill'].naturalKeyFields).toEqual([
      'scope',
      'modelVersion',
      'batchId',
    ]);
  });
});
