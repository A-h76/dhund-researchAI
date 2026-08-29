import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)(
  'DHB-31 migration 016 FTS schema',
  () => {
    jest.setTimeout(180_000);

    it('exposes chunks.text, generated search_vector, and FTS/trigram indexes after migrate deploy', async () => {
      const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
      const databaseUrl = postgres.getConnectionUri();

      try {
        execSync('npx prisma migrate deploy', {
          cwd: ROOT,
          env: { ...process.env, DATABASE_URL: databaseUrl },
          encoding: 'utf8',
        });

        const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

        const textColumn = await prisma.$queryRaw<
          Array<{ column_name: string; is_generated: string }>
        >`
          SELECT column_name, is_generated
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'chunks'
            AND column_name IN ('text', 'search_vector')
          ORDER BY column_name
        `;
        expect(textColumn.map((r) => r.column_name)).toEqual(['search_vector', 'text']);
        expect(textColumn.find((r) => r.column_name === 'search_vector')?.is_generated).toBe(
          'ALWAYS',
        );

        const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'idx_chunks_fts',
              'idx_documents_title_trgm',
              'idx_documents_authors_trgm'
            )
          ORDER BY indexname
        `;
        expect(indexes.map((r) => r.indexname)).toEqual([
          'idx_chunks_fts',
          'idx_documents_authors_trgm',
          'idx_documents_title_trgm',
        ]);

        const chunkId = generateId();
        const versionId = generateId();
        const documentId = generateId();
        const projectId = generateId();
        const orgId = generateId();
        const userId = generateId();
        const userEmail = `fts-${userId}@example.com`;
        const storageKey = `fts-test/${chunkId}`;

        await prisma.$executeRaw`
          INSERT INTO users (id, email, display_name, created_at)
          VALUES (${userId}::uuid, ${userEmail}, 'FTS User', NOW())
        `;
        await prisma.$executeRaw`
          INSERT INTO organizations (id, kind, name, owner_user_id, created_at)
          VALUES (${orgId}::uuid, 'PERSONAL'::org_kind, 'Org', ${userId}::uuid, NOW())
        `;
        await prisma.$executeRaw`
          INSERT INTO projects (id, org_id, name, created_at)
          VALUES (${projectId}::uuid, ${orgId}::uuid, 'Project', NOW())
        `;
        await prisma.$executeRaw`
          INSERT INTO documents (id, project_id, org_id, title, storage_key, created_at, updated_at)
          VALUES (
            ${documentId}::uuid, ${projectId}::uuid, ${orgId}::uuid,
            'FTS Paper', ${storageKey}, NOW(), NOW()
          )
        `;
        await prisma.$executeRaw`
          INSERT INTO document_versions (id, document_id, version_no, storage_key, created_at)
          VALUES (${versionId}::uuid, ${documentId}::uuid, 1, ${storageKey + '/v1'}, NOW())
        `;
        await prisma.$executeRaw`
          INSERT INTO chunks (
            id, document_version_id, project_id, ordinal, char_span, token_count,
            block_ids, content_hash, chunker_version, text
          ) VALUES (
            ${chunkId}::uuid, ${versionId}::uuid, ${projectId}::uuid, 0,
            '{"start":0,"end":20}'::jsonb, 5, ARRAY[]::uuid[], 'fts-hash', 'v1',
            'randomized controlled trial outcomes'
          )
        `;

        const vectorRows = await prisma.$queryRaw<Array<{ has_term: boolean }>>`
          SELECT "search_vector" @@ plainto_tsquery('english', 'randomized trial') AS has_term
          FROM chunks WHERE id = ${chunkId}::uuid
        `;
        expect(vectorRows[0]?.has_term).toBe(true);

        const hits = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM chunks
          WHERE "search_vector" @@ plainto_tsquery('english', 'randomized trial')
            AND id = ${chunkId}::uuid
        `;
        expect(hits).toHaveLength(1);

        await prisma.$disconnect();
      } finally {
        await postgres.stop();
      }
    });
  },
);
