import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { GenericContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { AdapterRegistry } from '../../src/ai/adapters/adapter-registry';
import { createStubAdapters } from '../../src/ai/adapters/stub/stub-adapters';
import { BoundaryMetrics } from '../../src/ai/boundary/boundary-metrics';
import { GatewayDataBoundary } from '../../src/ai/boundary/gateway-data-boundary';
import { GatewayService } from '../../src/ai/gateway/gateway.service';
import { computeInputFingerprint } from '../../src/ai/gateway/input-fingerprint';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import { GATEWAY_SERVICE } from '../../src/ai/tokens';
import { ExtractProcessor } from '../../src/apps/worker/extract.processor';
import { OcrProcessor } from '../../src/apps/worker/ocr.processor';
import { ProcessorRegistry } from '../../src/apps/worker/processor-registry';
import { ExtractMetrics } from '../../src/ingestion/extract.metrics';
import { ExtractService } from '../../src/ingestion/extract.service';
import { locatorResolves } from '../../src/ingestion/extract.locator';
import { CHUNKER_VERSION } from '../../src/ingestion/extract.constants';
import { OcrMetrics } from '../../src/ai/ocr/ocr.metrics';
import { OcrService } from '../../src/ai/ocr/ocr.service';
import { EXTRACTOR_VERSION } from '../../src/ingestion/upload.constants';
import { BullmqQueueAdapter } from '../../src/l0/adapters/bullmq/bullmq-queue.adapter';
import { PdfjsParseAdapter } from '../../src/l0/adapters/pdfjs/pdfjs-parse.adapter';
import { PrismaAiExecutionLedgerAdapter } from '../../src/l0/adapters/prisma/prisma-ai-execution-ledger.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaExtractStoreAdapter } from '../../src/l0/adapters/prisma/prisma-extract-store.adapter';
import { RedisCacheAdapter } from '../../src/l0/adapters/redis/redis-cache.adapter';
import { RedisCounterAdapter } from '../../src/l0/adapters/redis/redis-counter.adapter';
import { RedisLeaseAdapter } from '../../src/l0/adapters/redis/redis-lease.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import {
  CACHE_SERVICE,
  COUNTER_SERVICE,
  EXTRACT_STORE,
  LEASE_SERVICE,
  OBJECT_STORAGE_SERVICE,
  PDF_PARSE_SERVICE,
  QUEUE_SERVICE,
} from '../../src/l0/ports';
import { resetAppConfigForTests } from '../../src/platform/config';
import { ConcurrencyModule } from '../../src/platform/concurrency/concurrency.module';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { JobEnqueueService } from '../../src/platform/logging';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { LoggerModule } from '../../src/platform/logging/logger.module';
import type { PlatformLogger } from '../../src/platform/logging';
import { QueuesModule } from '../../src/platform/queues/queues.module';
import { ReliabilityModule } from '../../src/platform/reliability/reliability.module';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');
const SCAN = join(__dirname, '..', 'fixtures', 'ocr', 'spytm_Scanned.pdf');

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

(integrationEnabled ? describe : describe.skip)('DHB-51 OCR scanned PDF chain', () => {
  jest.setTimeout(360_000);

  it('extracts a scanned PDF, consumes OCR, and writes Gateway blocks', async () => {
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
      installTestAppConfig({
        databaseUrl,
        redisUrl,
        logLevel: 'silent',
      });

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
      await database.connect('dhb51');
      await queue.connect('dhb51');
      await cache.connect('dhb51');
      await counter.connect('dhb51');
      await lease.connect('dhb51');

      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      await prisma.$connect();

      const orgId = generateId();
      const projectId = generateId();
      const documentId = generateId();
      const documentVersionId = generateId();
      const storageKey = `${orgId}/${projectId}/docs/scan.pdf`;
      const bytes = readFileSync(SCAN);
      const contentHash = createHash('sha256').update(bytes).digest('hex');

      await prisma.organization.create({
        data: { id: orgId, kind: 'TEAM', name: 'DHB-51 OCR' },
      });
      await prisma.project.create({
        data: { id: projectId, orgId, name: 'Scanned' },
      });
      await prisma.document.create({
        data: {
          id: documentId,
          orgId,
          projectId,
          title: 'SPYTM scanned',
          storageKey,
          status: 'queued',
        },
      });
      await prisma.documentVersion.create({
        data: {
          id: documentVersionId,
          documentId,
          versionNo: 1,
          storageKey,
        },
      });

      const storage = new MemoryObjectStorage();
      storage.put(storageKey, bytes);
      const storageGet = jest.spyOn(storage, 'getObjectBytes');
      const storagePresign = jest.spyOn(storage, 'getPresignedGetUrl');

      const extractStore = new PrismaExtractStoreAdapter(database);
      const ledger = new PrismaAiExecutionLedgerAdapter(database);
      const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as unknown as PlatformLogger;
      const gateway = new GatewayService(
        new GatewayDataBoundary(
          { append: async () => undefined },
          new BoundaryMetrics(),
          logger,
        ),
        ledger,
        new PolicyResolver(),
        new PromptAssembler(),
        AdapterRegistry.forAdapters(createStubAdapters(storage)),
        logger,
      );
      const executeSpy = jest.spyOn(gateway, 'execute');

      moduleRef = await Test.createTestingModule({
        imports: [LoggerModule, QueuesModule, ReliabilityModule, ConcurrencyModule],
        providers: [
          ProcessorRegistry,
          ExtractMetrics,
          ExtractService,
          ExtractProcessor,
          OcrMetrics,
          OcrService,
          OcrProcessor,
          { provide: EXTRACT_STORE, useValue: extractStore },
          { provide: OBJECT_STORAGE_SERVICE, useValue: storage },
          { provide: PDF_PARSE_SERVICE, useValue: new PdfjsParseAdapter() },
          { provide: GATEWAY_SERVICE, useValue: gateway },
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
        .overrideProvider(EXTRACT_STORE)
        .useValue(extractStore)
        .overrideProvider(OBJECT_STORAGE_SERVICE)
        .useValue(storage)
        .overrideProvider(PDF_PARSE_SERVICE)
        .useValue(new PdfjsParseAdapter())
        .compile();

      await moduleRef.init();

      const enqueue = moduleRef.get(JobEnqueueService);
      await runWithCorrelationIdAsync('cor-dhb51-scan', () =>
        enqueue.enqueue('extract', {
          orgId,
          projectId,
          documentVersionId,
          contentHash,
          extractorVersion: EXTRACTOR_VERSION,
        }),
      );

      const blocks = await waitFor('OCR document_blocks', async () => {
        const rows = await extractStore.listBlocks(documentVersionId);
        return rows.length > 0 ? rows : null;
      });

      expect(blocks[0]?.page).toBe(1);
      expect(blocks[0]?.text).toBe('stub-ocr-text');
      expect(
        locatorResolves(
          {
            blockId: blocks[0]!.id,
            documentVersionId,
            page: blocks[0]!.page,
          },
          blocks[0] ?? null,
        ),
      ).toBe(true);

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ orgId, projectId }),
        { capability: 'OCR', objectKey: storageKey },
      );
      const ocrRequest = executeSpy.mock.calls[0]?.[1];
      expect(ocrRequest).toEqual({ capability: 'OCR', objectKey: storageKey });
      expect(JSON.stringify(ocrRequest)).not.toMatch(/presigned/i);

      expect(storagePresign).toHaveBeenCalled();
      expect(storageGet).toHaveBeenCalled();

      const executions = await prisma.aiExecution.findMany({
        where: { capability: 'OCR', orgId },
      });
      expect(executions).toHaveLength(1);
      expect(executions[0]?.inputFingerprint).toBe(
        computeInputFingerprint({ capability: 'OCR', objectKey: storageKey }),
      );

      const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      expect(document.status).not.toBe('completed');
      expect(document.status).toBe('processing');

      const chunkDepth = await queue.getQueueDepth('chunk');
      expect(chunkDepth.waiting + chunkDepth.delayed + chunkDepth.active).toBeGreaterThan(0);

      const ocr = moduleRef.get(OcrService);
      const second = await runWithCorrelationIdAsync('cor-dhb51-scan-2', () =>
        ocr.run({
          orgId,
          projectId,
          documentVersionId,
          contentHash,
          extractorVersion: EXTRACTOR_VERSION,
        }),
      );
      expect(second).toMatchObject({ kind: 'ocr', idempotent: true });
      expect(executeSpy).toHaveBeenCalledTimes(1);
      const executionsAfter = await prisma.aiExecution.findMany({
        where: { capability: 'OCR', orgId },
      });
      expect(executionsAfter).toHaveLength(1);
      expect(CHUNKER_VERSION).toBe('v1');
    } finally {
      if (moduleRef !== undefined) {
        await moduleRef.close();
      }
      await queue?.disconnect('dhb51');
      await cache?.disconnect('dhb51');
      await counter?.disconnect('dhb51');
      await lease?.disconnect('dhb51');
      await database?.disconnect('dhb51');
      await prisma?.$disconnect();
      resetAppConfigForTests();
      await redis.stop();
      await postgres.stop();
    }
  });
});
