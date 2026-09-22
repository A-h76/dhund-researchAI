import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { GenericContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { ChunkProcessor } from '../../src/apps/worker/chunk.processor';
import { ProcessorRegistry } from '../../src/apps/worker/processor-registry';
import { CHUNKER_VERSION } from '../../src/ingestion/extract.constants';
import { ChunkMetrics } from '../../src/ingestion/chunk.metrics';
import { ChunkService } from '../../src/ingestion/chunk.service';
import { isChunkStale } from '../../src/ingestion/chunk.blocks';
import { BullmqQueueAdapter } from '../../src/l0/adapters/bullmq/bullmq-queue.adapter';
import { PrismaChunkStoreAdapter } from '../../src/l0/adapters/prisma/prisma-chunk-store.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaExtractStoreAdapter } from '../../src/l0/adapters/prisma/prisma-extract-store.adapter';
import { PrismaOutboxAdapter } from '../../src/l0/adapters/prisma/prisma-outbox.adapter';
import { PrismaUploadSessionAdapter } from '../../src/l0/adapters/prisma/prisma-upload-session.adapter';
import { RedisCacheAdapter } from '../../src/l0/adapters/redis/redis-cache.adapter';
import { RedisCounterAdapter } from '../../src/l0/adapters/redis/redis-counter.adapter';
import { RedisLeaseAdapter } from '../../src/l0/adapters/redis/redis-lease.adapter';
import { L0Module } from '../../src/l0/l0.module';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { DocumentTransitionError } from '../../src/l0/ports/document-state';
import {
  CACHE_SERVICE,
  CHUNK_STORE,
  COUNTER_SERVICE,
  EXTRACT_STORE,
  LEASE_SERVICE,
  OUTBOX_SERVICE,
  QUEUE_SERVICE,
} from '../../src/l0/ports';
import { resetAppConfigForTests } from '../../src/platform/config';
import { ConcurrencyModule } from '../../src/platform/concurrency/concurrency.module';
import { OutboxWriterService } from '../../src/platform/events/outbox-writer.service';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { JobEnqueueService } from '../../src/platform/logging';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { LoggerModule } from '../../src/platform/logging/logger.module';
import { QueuesModule } from '../../src/platform/queues/queues.module';
import { ReliabilityModule } from '../../src/platform/reliability/reliability.module';
import { installTestAppConfig } from '../fixtures/app-config.fixture';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

async function waitFor<T>(
  label: string,
  probe: () => Promise<T | null>,
  timeoutMs = 60_000,
): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await probe();
      if (value !== null) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const extra = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`timed out waiting for ${label}${extra}`);
}

(integrationEnabled ? describe : describe.skip)('DHB-52 chunk job chain', () => {
  jest.setTimeout(360_000);

  it('chunks blocks, co-commits status+outbox, versions DOI re-ingest, rejects forbidden moves', async () => {
    const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    let moduleRef: TestingModule | undefined;
    let prisma: PrismaClient | undefined;
    let database: PrismaDatabaseAdapter | undefined;
    let queue: BullmqQueueAdapter | undefined;
    let cache: RedisCacheAdapter | undefined;
    let counter: RedisCounterAdapter | undefined;
    let lease: RedisLeaseAdapter | undefined;

    try {
      const databaseUrl = postgres.getConnectionUri();
      const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
      execSync('npx prisma migrate deploy', {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      });
      installTestAppConfig({ databaseUrl, redisUrl, logLevel: 'silent' });

      const connectionConfig: L0ConnectionConfig = {
        databaseUrl,
        redisUrl,
        databasePoolSize: 5,
      };
      database = new PrismaDatabaseAdapter(connectionConfig);
      queue = new BullmqQueueAdapter(connectionConfig);
      cache = new RedisCacheAdapter(connectionConfig);
      counter = new RedisCounterAdapter(connectionConfig);
      lease = new RedisLeaseAdapter(connectionConfig);
      await database.connect('dhb52');
      await queue.connect('dhb52');
      await cache.connect('dhb52');
      await counter.connect('dhb52');
      await lease.connect('dhb52');

      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      await prisma.$connect();

      const orgId = generateId();
      const projectId = generateId();
      const documentId = generateId();
      const documentVersionId = generateId();
      const storageKey = `${orgId}/${projectId}/docs/paper.pdf`;
      const contentHash = 'a'.repeat(64);

      await prisma.organization.create({
        data: { id: orgId, kind: 'TEAM', name: 'DHB-52 Chunk' },
      });
      await prisma.project.create({ data: { id: projectId, orgId, name: 'Chunking' } });
      await prisma.document.create({
        data: {
          id: documentId,
          orgId,
          projectId,
          title: 'Chunk target',
          storageKey,
          status: 'processing',
        },
      });
      await prisma.documentVersion.create({
        data: { id: documentVersionId, documentId, versionNo: 1, storageKey },
      });

      const extractStore = new PrismaExtractStoreAdapter(database);
      const chunkStore = new PrismaChunkStoreAdapter(database);
      const outboxAdapter = new PrismaOutboxAdapter(database);

      await extractStore.insertExtractionWithBlocks({
        extractionId: generateId(),
        documentVersionId,
        extractorVersion: 'v1',
        contentHash,
        blocks: Array.from({ length: 6 }, (_, ordinal) => ({
          id: generateId(),
          type: 'paragraph' as const,
          page: ordinal + 1,
          bbox: null,
          text: `Paragraph ${ordinal} of the canonical extraction. `.repeat(20),
          ordinal,
        })),
      });

      moduleRef = await Test.createTestingModule({
        imports: [LoggerModule, L0Module, QueuesModule, ReliabilityModule, ConcurrencyModule],
        providers: [
          ProcessorRegistry,
          ChunkMetrics,
          ChunkService,
          ChunkProcessor,
          OutboxWriterService,
          { provide: EXTRACT_STORE, useValue: extractStore },
          { provide: CHUNK_STORE, useValue: chunkStore },
          { provide: OUTBOX_SERVICE, useValue: outboxAdapter },
        ],
      })
        .overrideProvider(QUEUE_SERVICE)
        .useValue(queue)
        .overrideProvider(CACHE_SERVICE)
        .useValue(cache)
        .overrideProvider(COUNTER_SERVICE)
        .useValue(counter)
        .overrideProvider(LEASE_SERVICE)
        .useValue(lease)
        .compile();
      await moduleRef.init();

      // 1. Consume a chunk job end-to-end via the queue.
      const enqueue = moduleRef.get(JobEnqueueService);
      await runWithCorrelationIdAsync('cor-dhb52', () =>
        enqueue.enqueue('chunk', {
          orgId,
          projectId,
          documentVersionId,
          chunkerVersion: CHUNKER_VERSION,
          contentHash,
        }),
      );

      const chunks = await waitFor('chunk rows', async () => {
        const rows = await prisma!.chunk.findMany({
          where: { documentVersionId },
          orderBy: { ordinal: 'asc' },
        });
        return rows.length > 0 ? rows : null;
      });

      // chunks.text written once from blocks; projection reconstructs.
      const blocks = await extractStore.listBlocks(documentVersionId);
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeGreaterThan(0);
        expect(
          isChunkStale(
            {
              blockIds: chunk.blockIds,
              charSpan: chunk.charSpan as unknown as { start: number; end: number },
              text: chunk.text,
            },
            blocks,
          ),
        ).toBe(false);
      }

      // document.chunked + document.completed + status commit atomically.
      const document = await waitFor('completed document', async () => {
        const row = await prisma!.document.findUniqueOrThrow({ where: { id: documentId } });
        return row.status === 'completed' ? row : null;
      });
      expect(document.status).toBe('completed');
      const outboxRows = await prisma.outbox.findMany({
        where: { aggregateId: documentId },
      });
      const eventTypes = outboxRows.map((row) => row.eventType).sort();
      expect(eventTypes).toEqual(
        ['ingestion.document.chunked', 'ingestion.document.completed'].sort(),
      );

      // embed enqueued for new content.
      const embedDepth = await queue.getQueueDepth('embed');
      expect(embedDepth.waiting + embedDepth.delayed + embedDepth.active).toBeGreaterThan(0);

      // 2. Forbidden transition rolls back the whole commit (chunks + outbox).
      const cancelledDoc = generateId();
      const cancelledVersion = generateId();
      await prisma.document.create({
        data: {
          id: cancelledDoc,
          orgId,
          projectId,
          title: 'Cancelled',
          storageKey: `${storageKey}.cancelled`,
          status: 'cancelled',
        },
      });
      await prisma.documentVersion.create({
        data: {
          id: cancelledVersion,
          documentId: cancelledDoc,
          versionNo: 1,
          storageKey: `${storageKey}.cancelled`,
        },
      });
      await expect(
        chunkStore.commitChunks({
          documentId: cancelledDoc,
          chunks: [
            {
              id: generateId(),
              documentVersionId: cancelledVersion,
              projectId,
              ordinal: 0,
              charSpan: { start: 0, end: 4 },
              tokenCount: 1,
              page: 1,
              section: null,
              blockIds: [generateId()],
              contentHash: 'b'.repeat(64),
              chunkerVersion: CHUNKER_VERSION,
              text: 'text',
            },
          ],
          toStatus: 'completed',
          outboxEvents: [
            {
              id: generateId(),
              aggregateType: 'document',
              aggregateId: cancelledDoc,
              eventType: 'ingestion.document.completed',
              schemaVersion: 1,
              payload: {},
              correlationId: 'cor-dhb52',
            },
          ],
        }),
      ).rejects.toThrow(DocumentTransitionError);
      expect(
        await prisma.chunk.count({ where: { documentVersionId: cancelledVersion } }),
      ).toBe(0);
      expect(await prisma.outbox.count({ where: { aggregateId: cancelledDoc } })).toBe(0);
      const cancelled = await prisma.document.findUniqueOrThrow({
        where: { id: cancelledDoc },
      });
      expect(cancelled.status).toBe('cancelled');

      // 3. DOI re-ingest: same project versions the document; other project forks.
      const uploads = new PrismaUploadSessionAdapter(database);
      const doi = '10.5555/dhb52.paper';
      const consumeUpload = async (targetProject: string, suffix: string) => {
        const sessionId = generateId();
        await uploads.insertIssued(
          {
            id: sessionId,
            projectId: targetProject,
            orgId,
            initiatedBy: generateId(),
            filename: `paper-${suffix}.pdf`,
            sizeBytes: 4,
            mimeType: 'application/pdf',
            storageKey: `${orgId}/${targetProject}/uploads/${suffix}.pdf`,
            expiresAt: new Date(Date.now() + 60_000),
            idempotencyScope: `upload:${targetProject}`,
            idempotencyKey: generateId(),
            requestFingerprint: 'fp',
          },
          10,
        );
        const consumed = await uploads.consume({
          sessionId,
          documentId: generateId(),
          documentVersionId: generateId(),
          title: `paper-${suffix}.pdf`,
          doi,
        });
        expect(consumed).not.toBeNull();
        return consumed!;
      };

      const v1 = await consumeUpload(projectId, 'v1');
      const v2 = await consumeUpload(projectId, 'v2');
      expect(v2.documentId).toBe(v1.documentId);
      expect(v2.documentVersionId).not.toBe(v1.documentVersionId);
      const versions = await prisma.documentVersion.findMany({
        where: { documentId: v1.documentId },
        orderBy: { versionNo: 'asc' },
      });
      expect(versions.map((row) => row.versionNo)).toEqual([1, 2]);
      const doiDocument = await prisma.document.findUniqueOrThrow({
        where: { id: v1.documentId },
      });
      expect(doiDocument.status).toBe('stale');

      const otherProject = generateId();
      await prisma.project.create({
        data: { id: otherProject, orgId, name: 'Other project' },
      });
      const foreign = await consumeUpload(otherProject, 'other');
      expect(foreign.documentId).not.toBe(v1.documentId);
      expect(
        await prisma.document.count({ where: { doi, deletedAt: null } }),
      ).toBe(2);
    } finally {
      if (moduleRef !== undefined) {
        await moduleRef.close();
      }
      await queue?.disconnect('dhb52');
      await cache?.disconnect('dhb52');
      await counter?.disconnect('dhb52');
      await lease?.disconnect('dhb52');
      await database?.disconnect('dhb52');
      await prisma?.$disconnect();
      resetAppConfigForTests();
      await redis.stop();
      await postgres.stop();
    }
  });
});
