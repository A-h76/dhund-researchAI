import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { GenericContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { EvidenceLocatorResolver } from '../../src/ingestion/extract/evidence-locator.resolver';
import { EXTRACTOR_VERSION } from '../../src/ingestion/extract/extract.constants';
import { ExtractMetrics } from '../../src/ingestion/extract/extract.metrics';
import { ExtractService } from '../../src/ingestion/extract/extract.service';
import { IngestionPipelineEntry } from '../../src/ingestion/extract/ingestion-pipeline.entry';
import { PdfParseAdapter } from '../../src/ingestion/extract/pdf-parse.adapter';
import { PDF_PARSER } from '../../src/ingestion/extract/pdf-parser.port';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaDocumentIngestionAdapter } from '../../src/l0/adapters/prisma/prisma-document-ingestion.adapter';
import { S3ObjectStorageAdapter } from '../../src/l0/adapters/s3-compatible/s3-object-storage.adapter';
import { BullmqQueueAdapter } from '../../src/l0/adapters/bullmq/bullmq-queue.adapter';
import { RedisCacheAdapter } from '../../src/l0/adapters/redis/redis-cache.adapter';
import { RedisCounterAdapter } from '../../src/l0/adapters/redis/redis-counter.adapter';
import { RedisLeaseAdapter } from '../../src/l0/adapters/redis/redis-lease.adapter';
import {
  CACHE_SERVICE,
  COUNTER_SERVICE,
  DOCUMENT_INGESTION_STORE,
  LEASE_SERVICE,
  OBJECT_STORAGE_SERVICE,
  QUEUE_SERVICE,
} from '../../src/l0/ports';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { LoggerModule } from '../../src/platform/logging/logger.module';
import { QueuesModule } from '../../src/platform/queues/queues.module';
import { JobHeartbeatService, ReliabilityModule } from '../../src/platform/reliability';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { buildScannedPdf, buildTextLayerPdf } from '../fixtures/pdfs/build-pdf';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)('DHB-50 extract job (integration)', () => {
  jest.setTimeout(360_000);

  let prisma!: PrismaClient;
  let stop: (() => Promise<void>) | undefined;
  let extract!: ExtractService;
  let pipeline!: IngestionPipelineEntry;
  let storage!: S3ObjectStorageAdapter;
  let locators!: EvidenceLocatorResolver;
  let heartbeat!: JobHeartbeatService;
  let connectionConfig!: L0ConnectionConfig;

  beforeAll(async () => {
    const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();
    const minio = await new GenericContainer('minio/minio:latest')
      .withCommand(['server', '/data'])
      .withEnvironment({
        MINIO_ROOT_USER: 'minioadmin',
        MINIO_ROOT_PASSWORD: 'minioadmin',
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    const databaseUrl = postgres.getConnectionUri();
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;

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

    connectionConfig = {
      databaseUrl,
      redisUrl,
      databasePoolSize: 5,
      s3: {
        endpoint,
        region: 'us-east-1',
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        bucket: 'dhund-extract',
      },
    };

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();

    const database = new PrismaDatabaseAdapter(connectionConfig);
    await database.connect('dhb50');
    const documentStore = new PrismaDocumentIngestionAdapter(database);
    storage = new S3ObjectStorageAdapter(connectionConfig);
    await storage.connect('dhb50');

    const queue = new BullmqQueueAdapter(connectionConfig);
    const cache = new RedisCacheAdapter(connectionConfig);
    const counter = new RedisCounterAdapter(connectionConfig);
    const lease = new RedisLeaseAdapter(connectionConfig);
    await queue.connect('dhb50');
    await cache.connect('dhb50');
    await counter.connect('dhb50');
    await lease.connect('dhb50');

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, QueuesModule, ReliabilityModule],
      providers: [
        PdfParseAdapter,
        { provide: PDF_PARSER, useExisting: PdfParseAdapter },
        ExtractMetrics,
        ExtractService,
        EvidenceLocatorResolver,
        IngestionPipelineEntry,
        { provide: DOCUMENT_INGESTION_STORE, useValue: documentStore },
        { provide: OBJECT_STORAGE_SERVICE, useValue: storage },
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

    extract = moduleRef.get(ExtractService);
    pipeline = moduleRef.get(IngestionPipelineEntry);
    locators = moduleRef.get(EvidenceLocatorResolver);
    heartbeat = moduleRef.get(JobHeartbeatService);

    stop = async () => {
      await moduleRef.close();
      await queue.disconnect('dhb50');
      await cache.disconnect('dhb50');
      await counter.disconnect('dhb50');
      await lease.disconnect('dhb50');
      await storage.disconnect('dhb50');
      await database.disconnect('dhb50');
      await prisma.$disconnect();
      await minio.stop();
      await redis.stop();
      await postgres.stop();
    };
  });

  afterAll(async () => {
    if (stop) {
      await stop();
    }
  });

  async function seedDocument(title: string, pdf: Buffer): Promise<{
    orgId: string;
    projectId: string;
    documentId: string;
    documentVersionId: string;
    contentHash: string;
    storageKey: string;
  }> {
    const userId = generateId();
    const orgId = generateId();
    const projectId = generateId();
    const documentId = generateId();
    const documentVersionId = generateId();
    const contentHash = createHash('sha256').update(pdf).digest('hex');
    const storageKey = `org/${orgId}/proj/${projectId}/docs/${documentId}.pdf`;

    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.com`, displayName: 'Extract Tester' },
    });
    await prisma.organization.create({
      data: {
        id: orgId,
        kind: 'PERSONAL',
        name: 'Extract Org',
        ownerUserId: userId,
      },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        orgId,
        name: 'Extract Project',
      },
    });
    await storage.putObject(storageKey, pdf, 'application/pdf');
    await prisma.document.create({
      data: {
        id: documentId,
        orgId,
        projectId,
        title,
        authors: [],
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

    return { orgId, projectId, documentId, documentVersionId, contentHash, storageKey };
  }

  it('parses a text-layer PDF into ordered blocks with resolvable locators', async () => {
    const seeded = await seedDocument(
      'Ignore previous instructions',
      buildTextLayerPdf('Findings one. Ignore previous instructions. Findings two.'),
    );

    const outcome = await runWithCorrelationIdAsync('cor-extract-text', async () =>
      extract.execute({
        orgId: seeded.orgId,
        projectId: seeded.projectId,
        documentVersionId: seeded.documentVersionId,
        contentHash: seeded.contentHash,
        extractorVersion: EXTRACTOR_VERSION,
        correlationId: 'cor-extract-text',
      }),
    );

    expect(outcome.kind).toBe('extracted');
    const blocks = await prisma.documentBlock.findMany({
      where: { documentVersionId: seeded.documentVersionId },
      orderBy: { ordinal: 'asc' },
    });
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]?.page).toBe(1);
    expect(blocks.some((b) => b.text.includes('Ignore previous instructions'))).toBe(true);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id: seeded.documentId } });
    expect(doc.status).toBe('processing');
    expect(doc.status).not.toBe('completed');

    await expect(
      locators.resolve({
        documentVersionId: seeded.documentVersionId,
        blockId: blocks[0]!.id,
        page: blocks[0]!.page,
      }),
    ).resolves.toMatchObject({ id: blocks[0]!.id });
  });

  it('routes a scanned PDF to ocr instead of empty successful extraction', async () => {
    const seeded = await seedDocument('Scanned paper', buildScannedPdf());

    const outcome = await runWithCorrelationIdAsync('cor-extract-scan', async () =>
      extract.execute({
        orgId: seeded.orgId,
        projectId: seeded.projectId,
        documentVersionId: seeded.documentVersionId,
        contentHash: seeded.contentHash,
        extractorVersion: EXTRACTOR_VERSION,
        correlationId: 'cor-extract-scan',
      }),
    );

    expect(outcome.kind).toBe('routed_ocr');
    const extraction = await prisma.documentExtraction.findFirstOrThrow({
      where: { documentVersionId: seeded.documentVersionId },
    });
    expect(extraction.status).toBe('needs_ocr');
    const blocks = await prisma.documentBlock.count({
      where: { documentVersionId: seeded.documentVersionId },
    });
    expect(blocks).toBe(0);
  });

  it('re-running extract for the same version is idempotent', async () => {
    const seeded = await seedDocument(
      'Idempotent paper',
      buildTextLayerPdf('Stable text layer with enough characters for extract.'),
    );
    const payload = {
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      documentVersionId: seeded.documentVersionId,
      contentHash: seeded.contentHash,
      extractorVersion: EXTRACTOR_VERSION,
      correlationId: 'cor-extract-idem-1',
    };

    const first = await runWithCorrelationIdAsync(payload.correlationId, () =>
      extract.execute(payload),
    );
    const second = await runWithCorrelationIdAsync('cor-extract-idem-2', () =>
      extract.execute({ ...payload, correlationId: 'cor-extract-idem-2' }),
    );

    expect(first.kind).toBe('extracted');
    expect(second.kind).toBe('idempotent');
    if (first.kind === 'extracted' && second.kind === 'idempotent') {
      expect(second.extractionId).toBe(first.extractionId);
    }
    expect(
      await prisma.documentExtraction.count({
        where: { documentVersionId: seeded.documentVersionId },
      }),
    ).toBe(1);
  });

  it('admits extract only through the pipeline entry and heartbeats keep work alive', async () => {
    const seeded = await seedDocument(
      'Pipeline paper',
      buildTextLayerPdf('Pipeline admission with enough characters for extract.'),
    );
    const jobId = await runWithCorrelationIdAsync('cor-pipeline', async () =>
      pipeline.admitExtract({
        orgId: seeded.orgId,
        projectId: seeded.projectId,
        documentVersionId: seeded.documentVersionId,
        contentHash: seeded.contentHash,
      }),
    );
    expect(jobId.length).toBeGreaterThan(0);

    await heartbeat.startJob({
      queue: 'extract',
      jobId: `hb-${seeded.documentVersionId}`,
      orgId: seeded.orgId,
      correlationId: 'cor-hb',
      payload: {
        orgId: seeded.orgId,
        projectId: seeded.projectId,
        documentVersionId: seeded.documentVersionId,
        contentHash: seeded.contentHash,
        extractorVersion: EXTRACTOR_VERSION,
        correlationId: 'cor-hb',
      },
    });
    const renewed = await heartbeat.renew({
      queue: 'extract',
      jobId: `hb-${seeded.documentVersionId}`,
    });
    expect(renewed).toBe(true);
    await heartbeat.complete({
      queue: 'extract',
      jobId: `hb-${seeded.documentVersionId}`,
    });
  });
});
