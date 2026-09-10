import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  EMBED_DIMENSION,
  EMBED_MODEL_ID,
  EMBED_MODEL_VERSION,
} from '../../src/ai/policy/embed-policy.constants';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaEmbeddingStoreAdapter } from '../../src/l0/adapters/prisma/prisma-embedding-store.adapter';
import { PrismaIdentityLookupAdapter } from '../../src/l0/adapters/prisma/prisma-identity-lookup.adapter';
import { PrismaRetrievalIndexAdapter } from '../../src/l0/adapters/prisma/prisma-retrieval-index.adapter';
import { PrismaScopedStoreAdapter } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import {
  EmbeddingDimensionMismatchError,
  type EmbeddingInsert,
} from '../../src/l0/ports/embedding-store.port';
import {
  HNSW_EF_CONSTRUCTION,
  HNSW_EF_SEARCH_DEFAULT,
  HNSW_INDEX_NAME,
  HNSW_M,
  HNSW_OPERATOR_CLASS,
  HNSW_WRITE_ACTIVE_MODEL_VERSION,
} from '../../src/l0/ports/hnsw.constants';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function vectorLiteral(dimensions: number, value = 0.1): string {
  return `[${Array.from({ length: dimensions }, () => value).join(',')}]`;
}

function vector(dimensions: number = EMBED_DIMENSION, value = 0.0125): number[] {
  return Array.from({ length: dimensions }, () => value);
}

(integrationEnabled ? describe : describe.skip)('DHB-54 HNSW + FTS index consumption', () => {
  jest.setTimeout(360_000);

  let prisma: PrismaClient;
  let database: PrismaDatabaseAdapter;
  let scoped: PrismaScopedStoreAdapter;
  let retrieval: PrismaRetrievalIndexAdapter;
  let identity: PrismaIdentityLookupAdapter;
  let embeddings: PrismaEmbeddingStoreAdapter;
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
    database = new PrismaDatabaseAdapter(connectionConfig);
    await database.connect('dhb54');
    scoped = new PrismaScopedStoreAdapter(database);
    retrieval = new PrismaRetrievalIndexAdapter(database);
    identity = new PrismaIdentityLookupAdapter(database);
    embeddings = new PrismaEmbeddingStoreAdapter(database);
    stop = async () => {
      await database.disconnect('dhb54');
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
    await prisma.organization.create({ data: { id: orgId, kind: 'TEAM', name: 'DHB-54' } });
    await prisma.project.create({ data: { id: projectId, orgId, name: 'Search' } });
    return { orgId, projectId };
  }

  async function seedChunk(input: {
    readonly orgId: string;
    readonly projectId: string;
    readonly title: string;
    readonly text: string;
    readonly authors?: readonly string[];
  }): Promise<{ documentId: string; chunkId: string }> {
    const documentId = generateId();
    const versionId = generateId();
    const chunkId = generateId();
    await prisma.document.create({
      data: {
        id: documentId,
        orgId: input.orgId,
        projectId: input.projectId,
        title: input.title,
        authors: [...(input.authors ?? [])],
        storageKey: `doc/${documentId}`,
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
    await prisma.chunk.create({
      data: {
        id: chunkId,
        documentVersionId: versionId,
        projectId: input.projectId,
        ordinal: 0,
        charSpan: { start: 0, end: input.text.length },
        tokenCount: 8,
        blockIds: [],
        contentHash: `hash-${chunkId}`,
        chunkerVersion: 'v1',
        text: input.text,
      },
    });
    return { documentId, chunkId };
  }

  async function insertEmbedding(input: {
    readonly chunkId: string;
    readonly projectId: string;
    readonly vector: string;
    readonly status: 'ok' | 'failed' | 'pending';
    readonly modelVersion?: string;
    readonly modelId?: string;
  }): Promise<void> {
    const modelVersion = input.modelVersion ?? HNSW_WRITE_ACTIVE_MODEL_VERSION;
    const modelId = input.modelId ?? EMBED_MODEL_ID;
    await prisma.$executeRaw`
      INSERT INTO chunk_embeddings (
        id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
      ) VALUES (
        ${generateId()}::uuid, ${input.chunkId}::uuid, ${input.projectId}::uuid,
        ${modelId}, ${modelVersion}, ${EMBED_DIMENSION},
        ${input.vector}::vector(1024), ${`hash-${input.chunkId}-${modelVersion}-${input.status}`},
        ${input.status}::embedding_status
      )
    `;
  }

  it('GAP-HNSW-01: the consumed HNSW index keeps name, ops, m, and ef_construction', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string; indexname: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ${HNSW_INDEX_NAME}
    `;
    expect(rows).toHaveLength(1);
    const def = rows[0]?.indexdef ?? '';
    expect(def).toContain(`CREATE INDEX ${HNSW_INDEX_NAME}`);
    expect(def.toLowerCase()).toContain('using hnsw');
    expect(def).toContain(HNSW_OPERATOR_CLASS);
    expect(def).toContain(`m='${HNSW_M}'`);
    expect(def).toContain(`ef_construction='${HNSW_EF_CONSTRUCTION}'`);
    expect(def).toContain(HNSW_WRITE_ACTIVE_MODEL_VERSION);
    expect(def).toContain('ok');

    const hnswCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexdef ILIKE '%USING hnsw%'
    `;
    expect(Number(hnswCount[0]?.count)).toBe(1);
  });

  it('GAP-HNSW-01: changing ef_search at runtime changes the in-effect setting with no rebuild', async () => {
    const before = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = ${HNSW_INDEX_NAME}
    `;
    expect(await retrieval.readHnswEfSearch(40)).toBe(40);
    expect(await retrieval.readHnswEfSearch(HNSW_EF_SEARCH_DEFAULT)).toBe(80);
    const after = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = ${HNSW_INDEX_NAME}
    `;
    expect(after[0]?.indexdef).toBe(before[0]?.indexdef);
    expect(after[0]?.indexdef).toContain(`m='${HNSW_M}'`);
    expect(after[0]?.indexdef).toContain(`ef_construction='${HNSW_EF_CONSTRUCTION}'`);
  });

  it('excludes non-ok and non-active-version rows from ANN and respects project_id', async () => {
    const a = await seedProject();
    const b = await seedProject();
    const live = await seedChunk({
      orgId: a.orgId,
      projectId: a.projectId,
      title: 'Live paper',
      text: 'eligible vector chunk',
    });
    const failed = await seedChunk({
      orgId: a.orgId,
      projectId: a.projectId,
      title: 'Failed embed',
      text: 'failed vector chunk',
    });
    const otherVersion = await seedChunk({
      orgId: a.orgId,
      projectId: a.projectId,
      title: 'Other version',
      text: 'other version chunk',
    });
    const foreign = await seedChunk({
      orgId: b.orgId,
      projectId: b.projectId,
      title: 'Foreign paper',
      text: 'foreign vector chunk',
    });

    const query = vectorLiteral(1024, 0.42);
    await insertEmbedding({
      chunkId: live.chunkId,
      projectId: a.projectId,
      vector: query,
      status: 'ok',
    });
    await insertEmbedding({
      chunkId: failed.chunkId,
      projectId: a.projectId,
      vector: query,
      status: 'failed',
    });
    await insertEmbedding({
      chunkId: otherVersion.chunkId,
      projectId: a.projectId,
      vector: query,
      status: 'ok',
      modelVersion: 'embedding_v2',
      modelId: 'other-model',
    });
    await insertEmbedding({
      chunkId: foreign.chunkId,
      projectId: b.projectId,
      vector: query,
      status: 'ok',
    });

    const hits = await scoped.annNearest({ projectId: a.projectId }, query, 10, { efSearch: 80 });
    expect(hits.map((hit) => hit.chunkId)).toEqual([live.chunkId]);
    expect(hits.every((hit) => hit.projectId === a.projectId)).toBe(true);
  });

  it('rejects a cross-dimension write and a cross-dimension ANN query', async () => {
    const seeded = await seedProject();
    const chunk = await seedChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      title: 'Dim check',
      text: 'dimension guard',
    });
    const row: EmbeddingInsert = {
      id: generateId(),
      chunkId: chunk.chunkId,
      projectId: seeded.projectId,
      modelId: EMBED_MODEL_ID,
      modelVersion: EMBED_MODEL_VERSION,
      vector: vector(512),
      contentHash: `hash-${chunk.chunkId}`,
    };
    await expect(embeddings.insertEmbeddings([row])).rejects.toThrow(EmbeddingDimensionMismatchError);
    await expect(
      scoped.annNearest({ projectId: seeded.projectId }, vectorLiteral(3), 5),
    ).rejects.toThrow(EmbeddingDimensionMismatchError);
  });

  it('GAP-FTS-01: search_vector serves lexical queries scoped by project_id', async () => {
    const a = await seedProject();
    const b = await seedProject();
    const inScope = await seedChunk({
      orgId: a.orgId,
      projectId: a.projectId,
      title: 'RCT paper',
      text: 'randomized controlled trial outcomes in adults',
    });
    await seedChunk({
      orgId: b.orgId,
      projectId: b.projectId,
      title: 'Other RCT',
      text: 'randomized controlled trial outcomes in adults',
    });

    const hits = await retrieval.ftsSearch({
      scope: { projectId: a.projectId },
      query: 'randomized trial',
      limit: 10,
    });
    expect(hits.map((hit) => hit.chunkId)).toEqual([inScope.chunkId]);
    expect(hits[0]?.documentId).toBe(inScope.documentId);
  });

  it('GAP-FTS-01 / E-2: a trigram title match writes a pending MergeCandidate and never a WorkRelationship', async () => {
    const candidateId = generateId();
    const existingId = generateId();
    await prisma.canonicalWork.createMany({
      data: [
        {
          id: candidateId,
          canonicalTitle: 'The Metabolic Effects of Metformin in Adults',
          authorHash: 'hash-a',
          type: 'article',
        },
        {
          id: existingId,
          canonicalTitle: 'The Metabolic Effects of Metformin in Adult',
          authorHash: 'hash-b',
          type: 'article',
        },
      ],
    });

    const proposed = await identity.proposeMergeCandidatesByTitle({
      candidateWorkId: candidateId,
      title: 'The Metabolic Effects of Metformin in Adults',
      limit: 5,
      allocateId: generateId,
    });

    expect(proposed.length).toBeGreaterThan(0);
    expect(proposed.every((row) => row.status === 'pending')).toBe(true);
    expect(proposed.every((row) => row.matchType === 'fuzzy_title')).toBe(true);
    expect(proposed.some((row) => row.existingWorkId === existingId)).toBe(true);

    const relationships = await prisma.workRelationship.count();
    expect(relationships).toBe(0);
    const merged = await prisma.mergeCandidate.count({ where: { status: 'merged' } });
    expect(merged).toBe(0);
  });
});
