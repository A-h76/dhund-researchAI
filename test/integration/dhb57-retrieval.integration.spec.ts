import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  EMBED_MODEL_ID,
  EMBED_MODEL_VERSION,
} from '../../src/ai/policy/embed-policy.constants';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaEvidenceLookupAdapter } from '../../src/l0/adapters/prisma/prisma-evidence-lookup.adapter';
import { PrismaRetrievalIndexAdapter } from '../../src/l0/adapters/prisma/prisma-retrieval-index.adapter';
import { PrismaRetrievalTraceAdapter } from '../../src/l0/adapters/prisma/prisma-retrieval-trace.adapter';
import { PrismaScopedStoreAdapter } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { AnnSearch } from '../../src/retrieval/ann-search';
import { LexicalSearch } from '../../src/retrieval/lexical-search';
import { RetrievalMetrics } from '../../src/retrieval/retrieval.metrics';
import { RetrievalService } from '../../src/retrieval/retrieval.service';
import { buildTestAppConfig } from '../fixtures/app-config.fixture';
import { MemoryQueryEmbed } from '../fixtures/memory-query-embed';
import { MemoryRerank } from '../fixtures/memory-rerank';
import { stubLogger } from '../fixtures/memory-retrieval-service';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function vectorLiteral(dimensions: number, value = 0.33): string {
  return `[${Array.from({ length: dimensions }, () => value).join(',')}]`;
}

(integrationEnabled ? describe : describe.skip)('DHB-57 retrieval traces and evidence mapping', () => {
  jest.setTimeout(360_000);

  let prisma: PrismaClient;
  let service: RetrievalService;
  let traces: PrismaRetrievalTraceAdapter;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const databaseUrl = postgres.getConnectionUri();
    execSync('npx prisma migrate deploy', {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    const connectionConfig: L0ConnectionConfig = {
      databaseUrl,
      redisUrl: 'redis://127.0.0.1:9',
      databasePoolSize: 5,
    };
    const database = new PrismaDatabaseAdapter(connectionConfig);
    await database.connect('dhb57');
    const metrics = new RetrievalMetrics(stubLogger());
    const embed = new MemoryQueryEmbed();
    embed.vectorLiteral = vectorLiteral(1024, 0.33);
    traces = new PrismaRetrievalTraceAdapter(database);
    service = new RetrievalService(
      embed,
      new AnnSearch(new PrismaScopedStoreAdapter(database), buildTestAppConfig(), metrics),
      new LexicalSearch(new PrismaRetrievalIndexAdapter(database), metrics),
      new MemoryRerank(),
      metrics,
      new PrismaEvidenceLookupAdapter(database),
      traces,
    );
    stop = async () => {
      await database.disconnect('dhb57');
      await prisma.$disconnect();
      await postgres.stop();
    };
  });

  afterAll(async () => {
    if (stop !== undefined) {
      await stop();
    }
  });

  async function seedProject(): Promise<{ orgId: string; projectId: string }> {
    const orgId = generateId();
    const projectId = generateId();
    await prisma.organization.create({ data: { id: orgId, kind: 'TEAM', name: 'DHB-57' } });
    await prisma.project.create({ data: { id: projectId, orgId, name: 'Search' } });
    return { orgId, projectId };
  }

  async function seedEligibleChunk(input: {
    readonly orgId: string;
    readonly projectId: string;
    readonly text: string;
  }): Promise<{ documentId: string; chunkId: string }> {
    const documentId = generateId();
    const versionId = generateId();
    const chunkId = generateId();
    const blockId = generateId();
    await prisma.document.create({
      data: {
        id: documentId,
        orgId: input.orgId,
        projectId: input.projectId,
        title: 'Eligible',
        storageKey: `doc/${documentId}`,
        status: 'completed',
      },
    });
    await prisma.documentVersion.create({
      data: {
        id: versionId,
        documentId,
        versionNo: 1,
        storageKey: `doc/${documentId}/v1`,
      },
    });
    await prisma.documentBlock.create({
      data: {
        id: blockId,
        documentVersionId: versionId,
        type: 'paragraph',
        page: 1,
        text: input.text,
        ordinal: 0,
      },
    });
    await prisma.chunk.create({
      data: {
        id: chunkId,
        documentVersionId: versionId,
        projectId: input.projectId,
        ordinal: 0,
        charSpan: { start: 0, end: input.text.length },
        tokenCount: 8,
        blockIds: [blockId],
        contentHash: `hash-${chunkId}`,
        chunkerVersion: 'v1',
        text: input.text,
      },
    });
    await prisma.$executeRaw`
      INSERT INTO chunk_embeddings (
        id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
      ) VALUES (
        ${generateId()}::uuid, ${chunkId}::uuid, ${input.projectId}::uuid,
        ${EMBED_MODEL_ID}, ${EMBED_MODEL_VERSION},
        1024, ${vectorLiteral(1024, 0.33)}::vector(1024), ${`hash-${chunkId}`},
        ${'ok'}::embedding_status
      )
    `;
    return { documentId, chunkId };
  }

  it('persists a RetrievalTrace whose fingerprint is queryable from Postgres', async () => {
    const seeded = await seedProject();
    const live = await seedEligibleChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      text: 'randomized metformin trial',
    });
    const sourceId = generateId();
    const evidenceId = generateId();
    await prisma.source.create({
      data: {
        id: sourceId,
        projectId: seeded.projectId,
        type: 'document',
        documentId: live.documentId,
      },
    });
    await prisma.evidence.create({
      data: {
        id: evidenceId,
        projectId: seeded.projectId,
        sourceId,
        chunkId: live.chunkId,
        locator: { page: 1 },
        text: 'randomized metformin trial',
        stance: 'supports',
        qualityScore: 0.91,
        extractionMethod: 'deterministic',
        type: 'body_grounded',
      },
    });

    const result = await service.retrieve({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      query: 'metformin trial',
      k: 5,
      correlationId: 'corr-dhb57',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.hits[0]?.chunkId).toBe(live.chunkId);
    expect(result.hits[0]?.evidenceRefs).toEqual([evidenceId]);
    expect(result.hits[0]?.sourceId).toBe(sourceId);
    expect(result.hits[0]?.qualityAnnotation).toBe('body_grounded');
    expect(result.hits[0]?.vectorScore).not.toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const row = await prisma.retrievalTrace.findFirst({
      where: { projectId: seeded.projectId, queryFingerprint: result.trace.fingerprint },
    });
    expect(row).not.toBeNull();
    expect(row?.id).toBe(result.trace.id);
    const loaded = await traces.findLatestByFingerprint(
      { projectId: seeded.projectId },
      result.trace.fingerprint,
    );
    expect(loaded?.id).toBe(result.trace.id);
    expect(loaded?.queryFingerprint).toBe(result.trace.fingerprint);
  });

  it('returns zero of another project\'s chunks', async () => {
    const a = await seedProject();
    const b = await seedProject();
    const inA = await seedEligibleChunk({
      orgId: a.orgId,
      projectId: a.projectId,
      text: 'cross project metformin',
    });
    await seedEligibleChunk({
      orgId: b.orgId,
      projectId: b.projectId,
      text: 'cross project metformin',
    });
    const result = await service.retrieve({
      orgId: a.orgId,
      projectId: a.projectId,
      query: 'metformin',
      k: 10,
      correlationId: 'corr-iso',
      runtimeRole: RuntimeRole.Api,
    });
    expect(result.hits.map((hit) => hit.chunkId)).toEqual([inA.chunkId]);
    expect(result.hits.every((hit) => hit.documentId.length > 0)).toBe(true);
  });
});
