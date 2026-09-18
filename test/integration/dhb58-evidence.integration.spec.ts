import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { EvidenceMetrics } from '../../src/evidence/evidence.metrics';
import { EvidenceRepository } from '../../src/evidence/evidence.repository';
import { SourcesRepository } from '../../src/evidence/sources.repository';
import { PrismaChunkStoreAdapter } from '../../src/l0/adapters/prisma/prisma-chunk-store.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaExtractStoreAdapter } from '../../src/l0/adapters/prisma/prisma-extract-store.adapter';
import { PrismaScopedStoreAdapter } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import type { PlatformLogger } from '../../src/platform/logging';
import { ScopedMetrics } from '../../src/platform/persistence/scoped.metrics';
import { ScopedReader } from '../../src/platform/persistence/scoped-reader';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

function isCheckViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /check constraint|violates check/i.test(msg);
}

function isForeignKeyViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /foreign key|violates foreign key|restrict/i.test(msg);
}

async function expectRejectsCheck(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected check violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected check violation') {
      throw error;
    }
    expect(isCheckViolation(error)).toBe(true);
  }
}

async function expectRejectsForeignKey(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected foreign key violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected foreign key violation') {
      throw error;
    }
    expect(isForeignKeyViolation(error)).toBe(true);
  }
}

(integrationEnabled ? describe : describe.skip)(
  'DHB-58 sources exclusivity and evidence RESTRICT (integration)',
  () => {
    jest.setTimeout(360_000);

    let prisma: PrismaClient;
    let sources: SourcesRepository;
    let evidence: EvidenceRepository;
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
      await database.connect();
      const store = new PrismaScopedStoreAdapter(database);
      const extract = new PrismaExtractStoreAdapter(database);
      const chunks = new PrismaChunkStoreAdapter(database);
      const reader = new ScopedReader(store, new ScopedMetrics(stubLogger()));
      sources = new SourcesRepository(reader, store);
      evidence = new EvidenceRepository(
        reader,
        store,
        chunks,
        extract,
        new EvidenceMetrics(stubLogger()),
      );
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
      const orgId = generateId();
      const projectId = generateId();
      await prisma.organization.create({
        data: { id: orgId, kind: 'TEAM', name: 'DHB-58' },
      });
      await prisma.project.create({ data: { id: projectId, orgId, name: 'Evidence' } });
      return { orgId, projectId };
    }

    async function seedDocumentGraph(orgId: string, projectId: string) {
      const documentId = generateId();
      const versionId = generateId();
      const blockId = generateId();
      const chunkId = generateId();
      const storageKey = `doc/${documentId}`;
      const text = 'The trial enrolled 240 patients with glioma.';
      await prisma.document.create({
        data: {
          id: documentId,
          orgId,
          projectId,
          title: 'Paper',
          storageKey,
          status: 'completed',
        },
      });
      await prisma.documentVersion.create({
        data: { id: versionId, documentId, versionNo: 1, storageKey: `${storageKey}/v1` },
      });
      await prisma.documentBlock.create({
        data: {
          id: blockId,
          documentVersionId: versionId,
          type: 'paragraph',
          page: 1,
          text,
          ordinal: 0,
        },
      });
      await prisma.chunk.create({
        data: {
          id: chunkId,
          documentVersionId: versionId,
          projectId,
          ordinal: 0,
          charSpan: { start: 0, end: text.length },
          tokenCount: 8,
          page: 1,
          blockIds: [blockId],
          contentHash: `hash-${chunkId}`,
          chunkerVersion: 'v1',
          text,
        },
      });
      return { documentId, versionId, blockId, chunkId, text };
    }

    it('rejects sources with zero or two targets at DB and API', async () => {
      const { orgId, projectId } = await seedProject();
      const { documentId } = await seedDocumentGraph(orgId, projectId);
      const scope = { projectId };

      await expectRejectsCheck(() =>
        prisma.$executeRaw`
          INSERT INTO sources (id, project_id, type, document_id, external_record_id)
          VALUES (${generateId()}::uuid, ${projectId}::uuid, 'document'::source_type, NULL, NULL)
        `,
      );

      const rightsId = generateId();
      await prisma.rightsSnapshot.create({
        data: {
          id: rightsId,
          connectorId: `conn-${rightsId}`,
          policyVersion: 'v1',
          capabilities: { body: false },
          capturedAt: new Date(),
        },
      });
      const externalId = generateId();
      await prisma.externalRecord.create({
        data: {
          id: externalId,
          projectId,
          connectorId: 'openalex',
          externalId: `ext-${externalId}`,
          type: 'web_page',
          rightsSnapshotId: rightsId,
        },
      });

      await expectRejectsCheck(() =>
        prisma.$executeRaw`
          INSERT INTO sources (id, project_id, type, document_id, external_record_id)
          VALUES (
            ${generateId()}::uuid,
            ${projectId}::uuid,
            'document'::source_type,
            ${documentId}::uuid,
            ${externalId}::uuid
          )
        `,
      );

      await expect(
        sources.create(scope, { type: 'document' }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
      await expect(
        sources.create(scope, {
          type: 'document',
          documentId,
          externalRecordId: externalId,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });

      const created = await sources.create(scope, { type: 'document', documentId });
      expect(created.documentId).toBe(documentId);
    });

    it('rejects an empty locator at the database check', async () => {
      const { orgId, projectId } = await seedProject();
      const { documentId, chunkId } = await seedDocumentGraph(orgId, projectId);
      const sourceId = generateId();
      await prisma.source.create({
        data: { id: sourceId, projectId, type: 'document', documentId },
      });
      await expectRejectsCheck(() =>
        prisma.evidence.create({
          data: {
            id: generateId(),
            projectId,
            sourceId,
            chunkId,
            locator: {},
            text: 'no locator',
            qualityScore: 1,
            extractionMethod: 'deterministic',
            type: 'body_grounded',
          },
        }),
      );
    });

    it('restricts deleting an ai_execution referenced by evidence', async () => {
      const { orgId, projectId } = await seedProject();
      const graph = await seedDocumentGraph(orgId, projectId);
      const scope = { projectId };
      const source = await sources.create(scope, {
        type: 'document',
        documentId: graph.documentId,
      });
      const executionId = generateId();
      await prisma.aiExecution.create({
        data: {
          id: executionId,
          orgId,
          projectId,
          capability: 'STANCE',
          provider: 'openai',
          model: 'gpt-4o-mini',
          promptVersion: 'v1',
          inputFingerprint: 'fp',
          status: 'ok',
          method: 'llm',
          correlationId: generateId(),
        },
      });
      const row = await evidence.create(scope, {
        sourceId: source.id,
        type: 'body_grounded',
        extractionMethod: 'llm',
        aiExecutionId: executionId,
        text: 'The trial enrolled 240 patients',
        locator: {
          blockId: graph.blockId,
          documentVersionId: graph.versionId,
          page: 1,
        },
        chunkId: graph.chunkId,
        qualityScore: 0.9,
      });
      expect(row.aiExecutionId).toBe(executionId);

      await expectRejectsForeignKey(() =>
        prisma.aiExecution.delete({ where: { id: executionId } }),
      );
      const still = await prisma.evidence.findUnique({ where: { id: row.id } });
      expect(still?.aiExecutionId).toBe(executionId);
    });
  },
);
