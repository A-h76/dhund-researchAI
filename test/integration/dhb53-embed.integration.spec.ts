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
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import {
  EmbeddingDimensionMismatchError,
  type EmbeddingInsert,
} from '../../src/l0/ports/embedding-store.port';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function vector(dimensions: number = EMBED_DIMENSION, value = 0.0125): number[] {
  return Array.from({ length: dimensions }, () => value);
}

(integrationEnabled ? describe : describe.skip)('DHB-53 embedding writes', () => {
  jest.setTimeout(360_000);

  it('writes VECTOR(1024) rows, refuses other widths, and coexists across versions', async () => {
    const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();

    let prisma: PrismaClient | undefined;
    let database: PrismaDatabaseAdapter | undefined;

    try {
      const databaseUrl = postgres.getConnectionUri();
      execSync('npx prisma migrate deploy', {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      });

      const connectionConfig: L0ConnectionConfig = {
        databaseUrl,
        redisUrl: 'redis://unused:6379',
        databasePoolSize: 5,
      };
      database = new PrismaDatabaseAdapter(connectionConfig);
      await database.connect('dhb53');

      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      await prisma.$connect();

      const orgId = generateId();
      const projectId = generateId();
      const documentId = generateId();
      const documentVersionId = generateId();
      const chunkId = generateId();
      const contentHash = 'a'.repeat(64);
      const storageKey = `${orgId}/${projectId}/docs/paper.pdf`;

      await prisma.organization.create({
        data: { id: orgId, kind: 'TEAM', name: 'DHB-53 Embed' },
      });
      await prisma.project.create({ data: { id: projectId, orgId, name: 'Embedding' } });
      await prisma.document.create({
        data: { id: documentId, orgId, projectId, title: 'Embed target', storageKey, status: 'completed' },
      });
      await prisma.documentVersion.create({
        data: { id: documentVersionId, documentId, versionNo: 1, storageKey },
      });
      await prisma.chunk.create({
        data: {
          id: chunkId,
          documentVersionId,
          projectId,
          ordinal: 0,
          charSpan: { start: 0, end: 11 },
          tokenCount: 3,
          blockIds: [],
          contentHash,
          chunkerVersion: 'v1',
          text: 'Chunk text.',
        },
      });

      const store = new PrismaEmbeddingStoreAdapter(database);

      function row(overrides: Partial<EmbeddingInsert> = {}): EmbeddingInsert {
        return {
          id: generateId(),
          chunkId,
          projectId,
          modelId: EMBED_MODEL_ID,
          modelVersion: EMBED_MODEL_VERSION,
          vector: vector(),
          contentHash,
          ...overrides,
        };
      }

      // The chunk resolves with its owning document for the embed job.
      expect(await store.findChunk(chunkId)).toEqual({
        chunkId,
        projectId,
        documentId,
        documentVersionId,
        contentHash,
        text: 'Chunk text.',
      });

      // 1. A 1024-dim vector lands with the locked model id and version.
      expect(await store.insertEmbeddings([row()])).toBe(1);
      const stored = await prisma.$queryRaw<
        Array<{ model_id: string; model_version: string; dimensions: number; status: string }>
      >`SELECT model_id, model_version, dimensions, status FROM chunk_embeddings WHERE chunk_id = ${chunkId}::uuid`;
      expect(stored).toEqual([
        {
          model_id: EMBED_MODEL_ID,
          model_version: EMBED_MODEL_VERSION,
          dimensions: EMBED_DIMENSION,
          status: 'ok',
        },
      ]);

      // 2. A non-1024 vector is rejected at write, not truncated.
      await expect(store.insertEmbeddings([row({ vector: vector(512) })])).rejects.toThrow(
        EmbeddingDimensionMismatchError,
      );
      await expect(store.insertEmbeddings([row({ vector: vector(2048) })])).rejects.toThrow(
        EmbeddingDimensionMismatchError,
      );
      expect(
        await prisma.chunkEmbedding.count({ where: { chunkId, dimensions: { not: 1024 } } }),
      ).toBe(0);

      // 3. Re-running on unchanged content inserts nothing new.
      expect(await store.insertEmbeddings([row()])).toBe(0);
      expect(await prisma.chunkEmbedding.count({ where: { chunkId } })).toBe(1);

      // 4. Two versions coexist on the unique key; the first stays intact.
      expect(
        await store.insertEmbeddings([row({ modelVersion: 'embedding_v2' })]),
      ).toBe(1);
      const versions = await prisma.chunkEmbedding.findMany({
        where: { chunkId },
        select: { modelVersion: true },
        orderBy: { modelVersion: 'asc' },
      });
      expect(versions.map((entry) => entry.modelVersion)).toEqual([
        'embedding_v1',
        'embedding_v2',
      ]);

      // 5. The previous version's partial HNSW index survives the new version.
      const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'chunk_embeddings'
      `;
      expect(indexes.map((entry) => entry.indexname)).toContain(
        'idx_chunk_embeddings_hnsw_embedding_v1',
      );

      // 6. Embedded keys report both versions independently.
      expect(await store.listEmbeddedKeys(EMBED_MODEL_VERSION, [chunkId])).toEqual([
        { chunkId, contentHash },
      ]);
      expect(await store.listEmbeddedKeys('embedding_v3', [chunkId])).toEqual([]);

      // 7. Scope resolution pages by chunk id within the org.
      expect(
        await store.listChunksInScope({
          orgId,
          projectIds: [projectId],
          documentIds: null,
          afterChunkId: null,
          limit: 10,
        }),
      ).toHaveLength(1);
      expect(
        await store.listChunksInScope({
          orgId,
          projectIds: null,
          documentIds: [generateId()],
          afterChunkId: null,
          limit: 10,
        }),
      ).toHaveLength(0);
      expect(
        await store.listChunksInScope({
          orgId: generateId(),
          projectIds: null,
          documentIds: null,
          afterChunkId: null,
          limit: 10,
        }),
      ).toHaveLength(0);
    } finally {
      await prisma?.$disconnect();
      await database?.disconnect('dhb53');
      await postgres.stop();
    }
  });
});
