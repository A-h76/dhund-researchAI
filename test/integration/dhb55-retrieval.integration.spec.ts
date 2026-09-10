import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  EMBED_MODEL_ID,
  EMBED_MODEL_VERSION,
} from '../../src/ai/policy/embed-policy.constants';
import { ANN_NEAREST_SQL } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';
import { FTS_SEARCH_SQL } from '../../src/l0/adapters/prisma/prisma-retrieval-index.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaRetrievalIndexAdapter } from '../../src/l0/adapters/prisma/prisma-retrieval-index.adapter';
import { PrismaScopedStoreAdapter } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { HNSW_INDEX_NAME } from '../../src/l0/ports/hnsw.constants';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function vectorLiteral(dimensions: number, value = 0.1): string {
  return `[${Array.from({ length: dimensions }, () => value).join(',')}]`;
}

(integrationEnabled ? describe : describe.skip)('DHB-55 retrieval eligibility', () => {
  jest.setTimeout(360_000);

  let prisma: PrismaClient;
  let scoped: PrismaScopedStoreAdapter;
  let retrieval: PrismaRetrievalIndexAdapter;
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
    await database.connect('dhb55');
    scoped = new PrismaScopedStoreAdapter(database);
    retrieval = new PrismaRetrievalIndexAdapter(database);
    stop = async () => {
      await database.disconnect('dhb55');
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
    await prisma.organization.create({ data: { id: orgId, kind: 'TEAM', name: 'DHB-55' } });
    await prisma.project.create({ data: { id: projectId, orgId, name: 'Retrieval' } });
    return { orgId, projectId };
  }

  async function seedEligibleChunk(input: {
    readonly orgId: string;
    readonly projectId: string;
    readonly title: string;
    readonly text: string;
    readonly status?: 'completed' | 'processing' | 'queued';
    readonly deleted?: boolean;
    readonly retired?: boolean;
    readonly embedStatus?: 'ok' | 'failed' | 'pending';
    readonly modelVersion?: string;
    readonly modelId?: string;
    readonly rightsBody?: boolean | null;
    readonly bodyBlock?: boolean;
  }): Promise<{ documentId: string; chunkId: string; versionId: string }> {
    const documentId = generateId();
    const versionId = generateId();
    const chunkId = generateId();
    const blockId = generateId();
    let rightsSnapshotId: string | undefined;
    if (input.rightsBody !== undefined && input.rightsBody !== null) {
      rightsSnapshotId = generateId();
      await prisma.rightsSnapshot.create({
        data: {
          id: rightsSnapshotId,
          connectorId: `conn-${rightsSnapshotId}`,
          policyVersion: 'v1',
          capabilities: { body: input.rightsBody },
          capturedAt: new Date(),
        },
      });
    } else if (input.rightsBody === null) {
      rightsSnapshotId = generateId();
      await prisma.rightsSnapshot.create({
        data: {
          id: rightsSnapshotId,
          connectorId: `conn-${rightsSnapshotId}`,
          policyVersion: 'v1',
          capabilities: {},
          capturedAt: new Date(),
        },
      });
    }
    await prisma.document.create({
      data: {
        id: documentId,
        orgId: input.orgId,
        projectId: input.projectId,
        title: input.title,
        storageKey: `doc/${documentId}`,
        status: input.status ?? 'completed',
        deletedAt: input.deleted === true ? new Date() : null,
        ...(rightsSnapshotId !== undefined ? { rightsSnapshotId } : {}),
      },
    });
    await prisma.documentVersion.create({
      data: {
        id: versionId,
        documentId,
        versionNo: 1,
        storageKey: `doc/${documentId}/v1`,
        retiredAt: input.retired === true ? new Date() : null,
      },
    });
    const useBody = input.bodyBlock !== false;
    if (useBody) {
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
    }
    await prisma.chunk.create({
      data: {
        id: chunkId,
        documentVersionId: versionId,
        projectId: input.projectId,
        ordinal: 0,
        charSpan: { start: 0, end: input.text.length },
        tokenCount: 8,
        blockIds: useBody ? [blockId] : [],
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
        ${input.modelId ?? EMBED_MODEL_ID}, ${input.modelVersion ?? EMBED_MODEL_VERSION},
        1024, ${vectorLiteral(1024, 0.33)}::vector(1024), ${`hash-${chunkId}`},
        ${input.embedStatus ?? 'ok'}::embedding_status
      )
    `;
    return { documentId, chunkId, versionId };
  }

  it('excludes each ineligible predicate independently and does not delete retained rows', async () => {
    const seeded = await seedProject();
    const live = await seedEligibleChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      title: 'Live',
      text: 'eligible randomized trial outcomes',
    });
    const deleted = await seedEligibleChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      title: 'Deleted',
      text: 'eligible randomized trial outcomes',
      deleted: true,
    });
    const retired = await seedEligibleChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      title: 'Retired',
      text: 'eligible randomized trial outcomes',
      retired: true,
    });
    const incomplete = await seedEligibleChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      title: 'Incomplete',
      text: 'eligible randomized trial outcomes',
      status: 'processing',
    });
    const failedEmbed = await seedEligibleChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      title: 'Failed embed',
      text: 'eligible randomized trial outcomes',
      embedStatus: 'failed',
    });
    const otherVersion = await seedEligibleChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      title: 'Other version',
      text: 'eligible randomized trial outcomes',
      modelVersion: 'embedding_v2',
      modelId: 'other-model',
    });
    const rightsDenied = await seedEligibleChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      title: 'Rights denied',
      text: 'eligible randomized trial outcomes',
      rightsBody: false,
      bodyBlock: true,
    });

    const query = vectorLiteral(1024, 0.33);
    const annHits = await scoped.annNearest({ projectId: seeded.projectId }, query, 20, {
      efSearch: 80,
    });
    const ftsHits = await retrieval.ftsSearch({
      scope: { projectId: seeded.projectId },
      query: 'randomized trial',
      limit: 20,
    });

    expect(annHits.map((hit) => hit.chunkId)).toEqual([live.chunkId]);
    expect(ftsHits.map((hit) => hit.chunkId)).toEqual([live.chunkId]);

    expect(await prisma.document.count({ where: { id: deleted.documentId } })).toBe(1);
    expect(await prisma.documentVersion.count({ where: { id: retired.versionId } })).toBe(1);
    expect(await prisma.document.count({ where: { id: incomplete.documentId } })).toBe(1);
    expect(await prisma.chunkEmbedding.count({ where: { chunkId: failedEmbed.chunkId } })).toBe(1);
    expect(await prisma.chunkEmbedding.count({ where: { chunkId: otherVersion.chunkId } })).toBe(1);
    expect(await prisma.chunk.count({ where: { id: rightsDenied.chunkId } })).toBe(1);
  });

  it('returns zero of another project\'s chunks', async () => {
    const a = await seedProject();
    const b = await seedProject();
    const inA = await seedEligibleChunk({
      orgId: a.orgId,
      projectId: a.projectId,
      title: 'A',
      text: 'cross project randomized trial',
    });
    await seedEligibleChunk({
      orgId: b.orgId,
      projectId: b.projectId,
      title: 'B',
      text: 'cross project randomized trial',
    });
    const query = vectorLiteral(1024, 0.33);
    const annHits = await scoped.annNearest({ projectId: a.projectId }, query, 10);
    const ftsHits = await retrieval.ftsSearch({
      scope: { projectId: a.projectId },
      query: 'randomized trial',
      limit: 10,
    });
    expect(annHits.map((hit) => hit.chunkId)).toEqual([inA.chunkId]);
    expect(ftsHits.map((hit) => hit.chunkId)).toEqual([inA.chunkId]);
    expect(annHits.every((hit) => hit.projectId === a.projectId)).toBe(true);
    expect(ftsHits.every((hit) => hit.projectId === a.projectId)).toBe(true);
  });

  it('EXPLAIN places the project_id predicate in both arm plans', async () => {
    const seeded = await seedProject();
    await seedEligibleChunk({
      orgId: seeded.orgId,
      projectId: seeded.projectId,
      title: 'Plan',
      text: 'explain randomized trial',
    });
    const query = vectorLiteral(1024, 0.33);
    const annPlan = await prisma.$queryRawUnsafe<unknown[]>(
      `EXPLAIN (FORMAT JSON) ${ANN_NEAREST_SQL}`,
      seeded.projectId,
      query,
      5,
    );
    const ftsPlan = await prisma.$queryRawUnsafe<unknown[]>(
      `EXPLAIN (FORMAT JSON) ${FTS_SEARCH_SQL}`,
      seeded.projectId,
      'randomized trial',
      5,
    );
    const annText = JSON.stringify(annPlan).toLowerCase();
    const ftsText = JSON.stringify(ftsPlan).toLowerCase();
    expect(annText).toContain('project_id');
    expect(ftsText).toContain('project_id');
    expect(annText.includes(HNSW_INDEX_NAME) || annText.includes('hnsw') || annText.includes('chunk_embeddings')).toBe(
      true,
    );
    expect(ftsText).toContain('search_vector');
  });
});
