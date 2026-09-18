import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { CitationsService } from '../../src/evidence/citations.service';
import { CitationMetrics } from '../../src/evidence/citations.metrics';
import { SentenceProjectionService } from '../../src/evidence/sentence-projection.service';
import { PrismaCitationProjectionAdapter } from '../../src/l0/adapters/prisma/prisma-citation-projection.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaExtractStoreAdapter } from '../../src/l0/adapters/prisma/prisma-extract-store.adapter';
import { PrismaEvidenceSpineAdapter } from '../../src/l0/adapters/prisma/prisma-evidence-spine.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { DomainError } from '../../src/platform/errors/domain-error';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)(
  'DHB-61 citations and sentence projection (integration)',
  () => {
    jest.setTimeout(360_000);

    let prisma!: PrismaClient;
    let citations!: CitationsService;
    let projection!: SentenceProjectionService;
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
      const config: L0ConnectionConfig = {
        databaseUrl,
        redisUrl: 'redis://127.0.0.1:6379',
        databasePoolSize: 5,
      };
      const database = new PrismaDatabaseAdapter(config);
      await database.connect();
      const store = new PrismaCitationProjectionAdapter(database);
      const spine = new PrismaEvidenceSpineAdapter(database);
      const documents = new PrismaExtractStoreAdapter(database);
      citations = new CitationsService(store, spine);
      projection = new SentenceProjectionService(
        store,
        spine,
        documents,
        new CitationMetrics(),
        {
          info: jest.fn(),
          error: jest.fn(),
          warn: jest.fn(),
          debug: jest.fn(),
        } as unknown as PlatformLogger,
      );
      stop = async () => {
        await prisma.$disconnect();
        await postgres.stop();
      };
    });

    afterAll(async () => {
      if (stop) {
        await stop();
      }
    });

    async function seedProject(): Promise<{
      userId: string;
      projectId: string;
      orgId: string;
    }> {
      const userId = generateId();
      const orgId = generateId();
      const projectId = generateId();
      await prisma.user.create({
        data: { id: userId, email: `${userId}@example.com`, displayName: 'Cite Tester' },
      });
      await prisma.organization.create({
        data: { id: orgId, kind: 'PERSONAL', name: 'Org', ownerUserId: userId },
      });
      await prisma.project.create({ data: { id: projectId, orgId, name: 'Project' } });
      return { userId, projectId, orgId };
    }

    async function seedBoundSentence(input: {
      userId: string;
      projectId: string;
      orgId: string;
    }): Promise<{
      writingId: string;
      sentenceHash: string;
      evidenceId: string;
      documentVersionId: string;
      sourceId: string;
      chunkId: string;
    }> {
      const documentId = generateId();
      const documentVersionId = generateId();
      const chunkId = generateId();
      const sourceId = generateId();
      const evidenceId = generateId();
      const writingId = generateId();
      const writingVersionId = generateId();
      const blockId = generateId();
      const sentenceHash = `sha256:${generateId()}`;
      const storageKey = `doc/${generateId()}`;
      await prisma.document.create({
        data: { id: documentId, projectId: input.projectId, orgId: input.orgId, title: 'Paper', storageKey },
      });
      await prisma.documentVersion.create({
        data: {
          id: documentVersionId,
          documentId,
          versionNo: 1,
          storageKey: `${storageKey}/v1`,
        },
      });
      await prisma.chunk.create({
        data: {
          id: chunkId,
          documentVersionId,
          projectId: input.projectId,
          ordinal: 0,
          charSpan: { start: 0, end: 12 },
          tokenCount: 3,
          blockIds: [blockId],
          contentHash: `hash-${generateId()}`,
          chunkerVersion: 'v1',
          text: 'quoted fact',
        },
      });
      await prisma.source.create({
        data: { id: sourceId, projectId: input.projectId, type: 'document', documentId },
      });
      await prisma.evidence.create({
        data: {
          id: evidenceId,
          projectId: input.projectId,
          sourceId,
          chunkId,
          locator: { documentVersionId, blockId, page: 1 },
          text: 'quoted fact',
          qualityScore: 1,
          extractionMethod: 'deterministic',
          type: 'body_grounded',
        },
      });
      await prisma.writing.create({
        data: {
          id: writingId,
          projectId: input.projectId,
          title: 'Draft',
          type: 'manuscript',
          createdBy: input.userId,
        },
      });
      await prisma.writingVersion.create({
        data: {
          id: writingVersionId,
          writingId,
          versionNo: 1,
          contentRef: 'ref/v1',
          createdBy: input.userId,
        },
      });
      await prisma.writing.update({
        where: { id: writingId },
        data: { currentVersionId: writingVersionId },
      });
      await prisma.writingSentenceBinding.create({
        data: {
          id: generateId(),
          writingId,
          writingVersionId,
          projectId: input.projectId,
          sentenceHash,
          evidenceId,
          strength: 1,
        },
      });
      return { writingId, sentenceHash, evidenceId, documentVersionId, sourceId, chunkId };
    }

    it('rejects citation exclusivity violations at the repository', async () => {
      const seed = await seedProject();
      const seeded = await seedBoundSentence(seed);
      const { projectId } = seed;
      await expect(
        citations.create({
          projectId,
          cslJson: {},
          qualityAnnotation: 'metadata_only',
        }),
      ).rejects.toBeInstanceOf(DomainError);

      await expect(
        citations.create({
          projectId,
          resolvesToEvidenceId: seeded.evidenceId,
          resolvesToSourceId: seeded.sourceId,
          cslJson: {},
          qualityAnnotation: 'body_grounded',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });

      const created = await citations.create({
        projectId,
        resolvesToEvidenceId: seeded.evidenceId,
        cslJson: { title: 'Paper' },
        qualityAnnotation: 'body_grounded',
      });
      expect(created.qualityAnnotation).toBe('body_grounded');
      expect(created.resolvesToSourceId).toBeNull();
    });

    it('projects the full sentence→evidence chain from live relations', async () => {
      const seed = await seedProject();
      const bound = await seedBoundSentence(seed);
      const result = await projection.projectSentence({
        writingId: bound.writingId,
        sentenceHash: bound.sentenceHash,
        projectId: seed.projectId,
      });
      expect(result.status).toBe('complete');
      expect(result.chains[0]).toMatchObject({
        status: 'complete',
        evidenceId: bound.evidenceId,
        quality: 'body_grounded',
        chunk: { id: bound.chunkId, documentVersionId: bound.documentVersionId },
        source: { id: bound.sourceId },
      });
    });

    it('returns 404 for a writingId from another project', async () => {
      const home = await seedProject();
      const other = await seedProject();
      const bound = await seedBoundSentence(home);
      await expect(
        projection.projectSentence({
          writingId: bound.writingId,
          sentenceHash: bound.sentenceHash,
          projectId: other.projectId,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NotFound });
    });
  },
);
