import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaScopedStoreAdapter } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function vectorLiteral(dimensions: number, value = 0.1): string {
  return `[${Array(dimensions).fill(value).join(',')}]`;
}

(integrationEnabled ? describe : describe.skip)(
  'DHB-38 scoped store Postgres (integration)',
  () => {
    jest.setTimeout(360_000);

    let prisma: PrismaClient;
    let store: PrismaScopedStoreAdapter;
    let stop: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      const postgres = await new PostgreSqlContainer(
        'pgvector/pgvector:pg16',
      ).start();
      const databaseUrl = postgres.getConnectionUri();
      execSync('npx prisma migrate deploy', {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      });
      prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      });
      await prisma.$connect();
      const connectionConfig: L0ConnectionConfig = {
        databaseUrl,
        redisUrl: 'redis://127.0.0.1:9',
        databasePoolSize: 5,
      };
      const database = new PrismaDatabaseAdapter(connectionConfig);
      await database.connect();
      store = new PrismaScopedStoreAdapter(database);
      stop = async () => {
        await database.disconnect();
        await prisma.$disconnect();
        await postgres.stop();
      };
    });

    afterAll(async () => {
      if (stop !== undefined) {
        await stop();
      }
    });

    async function seedProject(): Promise<{
      orgId: string;
      projectId: string;
    }> {
      const userId = generateId();
      const orgId = generateId();
      const projectId = generateId();
      await prisma.user.create({
        data: {
          id: userId,
          email: `dhb38-${userId}@example.com`,
          displayName: 'Pat',
        },
      });
      await prisma.organization.create({
        data: { id: orgId, kind: 'TEAM', name: 'Org' },
      });
      await prisma.project.create({
        data: { id: projectId, orgId, name: 'Project' },
      });
      return { orgId, projectId };
    }

    async function seedDocument(
      projectId: string,
      orgId: string,
      title: string,
    ): Promise<string> {
      const id = generateId();
      await prisma.document.create({
        data: {
          id,
          projectId,
          orgId,
          title,
          storageKey: `doc/${id}`,
        },
      });
      return id;
    }

    it('hides a document that is not in the caller project scope', async () => {
      const a = await seedProject();
      const b = await seedProject();
      const documentId = await seedDocument(a.projectId, a.orgId, 'Secret');
      const scopeA = { projectId: a.projectId };
      const scopeB = { projectId: b.projectId };
      const owned = await store.get('document', scopeA, documentId);
      const hidden = await store.get('document', scopeB, documentId);
      expect(owned?.title).toBe('Secret');
      expect(hidden).toBeNull();
      expect(await store.update('document', scopeB, documentId, { title: 'X' })).toBeNull();
      expect(await store.delete('document', scopeB, documentId)).toBe(false);
      const listed = await store.list('document', scopeB, {
        limit: 50,
        afterId: documentId,
      });
      expect(listed).toEqual([]);
      const still = await store.get('document', scopeA, documentId);
      expect(still?.title).toBe('Secret');
    });

    it('returns ANN hits only for the scoped project_id', async () => {
      const a = await seedProject();
      const b = await seedProject();
      const docA = await seedDocument(a.projectId, a.orgId, 'A');
      const docB = await seedDocument(b.projectId, b.orgId, 'B');
      const versionA = generateId();
      const versionB = generateId();
      const chunkA = generateId();
      const chunkB = generateId();
      await prisma.documentVersion.create({
        data: {
          id: versionA,
          documentId: docA,
          versionNo: 1,
          storageKey: `doc/${docA}/v1`,
        },
      });
      await prisma.documentVersion.create({
        data: {
          id: versionB,
          documentId: docB,
          versionNo: 1,
          storageKey: `doc/${docB}/v1`,
        },
      });
      await prisma.chunk.create({
        data: {
          id: chunkA,
          documentVersionId: versionA,
          projectId: a.projectId,
          ordinal: 0,
          charSpan: { start: 0, end: 10 },
          tokenCount: 3,
          blockIds: [],
          contentHash: `hash-${chunkA}`,
          chunkerVersion: 'v1',
          text: '',
        },
      });
      await prisma.chunk.create({
        data: {
          id: chunkB,
          documentVersionId: versionB,
          projectId: b.projectId,
          ordinal: 0,
          charSpan: { start: 0, end: 10 },
          tokenCount: 3,
          blockIds: [],
          contentHash: `hash-${chunkB}`,
          chunkerVersion: 'v1',
          text: '',
        },
      });
      const vec = vectorLiteral(1024, 0.5);
      await prisma.$executeRaw`
        INSERT INTO chunk_embeddings (
          id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
        ) VALUES (
          ${generateId()}::uuid, ${chunkA}::uuid, ${a.projectId}::uuid,
          'voyage-4', 'embedding_v1', 1024, ${vec}::vector(1024), 'hash-a', 'ok'::embedding_status
        )
      `;
      await prisma.$executeRaw`
        INSERT INTO chunk_embeddings (
          id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
        ) VALUES (
          ${generateId()}::uuid, ${chunkB}::uuid, ${b.projectId}::uuid,
          'voyage-4', 'embedding_v1', 1024, ${vec}::vector(1024), 'hash-b', 'ok'::embedding_status
        )
      `;
      const hits = await store.annNearest({ projectId: a.projectId }, vec, 5);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((hit) => hit.projectId === a.projectId)).toBe(true);
      expect(hits.some((hit) => hit.chunkId === chunkB)).toBe(false);
    });
  },
);
