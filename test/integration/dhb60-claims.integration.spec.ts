import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { ClaimsGraphService } from '../../src/evidence/claims-graph.service';
import { ClaimsMetrics } from '../../src/evidence/claims.metrics';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaEvidenceSpineAdapter } from '../../src/l0/adapters/prisma/prisma-evidence-spine.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { DomainError } from '../../src/platform/errors/domain-error';
import { ErrorCode, httpStatusFor } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)(
  'DHB-60 claims graph (integration)',
  () => {
    jest.setTimeout(360_000);

    let prisma!: PrismaClient;
    let service!: ClaimsGraphService;
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
      const spine = new PrismaEvidenceSpineAdapter(database);
      service = new ClaimsGraphService(
        spine,
        new ClaimsMetrics(),
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

    async function seedProject(): Promise<{ projectId: string; orgId: string }> {
      const userId = generateId();
      const orgId = generateId();
      const projectId = generateId();
      await prisma.user.create({
        data: { id: userId, email: `${userId}@example.com`, displayName: 'Claim Tester' },
      });
      await prisma.organization.create({
        data: { id: orgId, kind: 'PERSONAL', name: 'Org', ownerUserId: userId },
      });
      await prisma.project.create({ data: { id: projectId, orgId, name: 'Project' } });
      return { projectId, orgId };
    }

    async function seedEvidence(projectId: string, orgId: string): Promise<string> {
      const documentId = generateId();
      const versionId = generateId();
      const chunkId = generateId();
      const sourceId = generateId();
      const evidenceId = generateId();
      const storageKey = `doc/${generateId()}`;
      await prisma.document.create({
        data: { id: documentId, projectId, orgId, title: 'Paper', storageKey },
      });
      await prisma.documentVersion.create({
        data: { id: versionId, documentId, versionNo: 1, storageKey: `${storageKey}/v1` },
      });
      await prisma.chunk.create({
        data: {
          id: chunkId,
          documentVersionId: versionId,
          projectId,
          ordinal: 0,
          charSpan: { start: 0, end: 12 },
          tokenCount: 3,
          blockIds: [],
          contentHash: `hash-${generateId()}`,
          chunkerVersion: 'v1',
          text: 'quoted fact',
        },
      });
      await prisma.source.create({
        data: { id: sourceId, projectId, type: 'document', documentId },
      });
      await prisma.evidence.create({
        data: {
          id: evidenceId,
          projectId,
          sourceId,
          chunkId,
          locator: { page: 1 },
          text: 'quoted fact',
          qualityScore: 1,
          extractionMethod: 'deterministic',
          type: 'body_grounded',
        },
      });
      return evidenceId;
    }

    it('RESTRICT-deletes a linked claim at the repository (409) and via FK', async () => {
      const { projectId } = await seedProject();
      const claim = await service.createClaim({
        projectId,
        text: 'Linked claim',
        method: 'deterministic',
      });
      const argument = await service.createArgument({
        projectId,
        title: 'Thesis',
        method: 'deterministic',
      });
      await service.linkClaimToArgument({
        projectId,
        argumentId: argument.id,
        claimId: claim.id,
      });

      await expect(service.deleteClaim(projectId, claim.id)).rejects.toBeInstanceOf(DomainError);
      try {
        await service.deleteClaim(projectId, claim.id);
      } catch (error) {
        expect((error as DomainError).code).toBe(ErrorCode.InvalidStateTransition);
        expect(httpStatusFor((error as DomainError).code)).toBe(409);
      }

      const surviving = await prisma.claim.findUnique({ where: { id: claim.id } });
      expect(surviving?.deletedAt).toBeNull();

      await expect(prisma.claim.delete({ where: { id: claim.id } })).rejects.toBeDefined();
    });

    it('rejects cross-project evidenceId on the scoped write path', async () => {
      const { projectId } = await seedProject();
      const other = await seedProject();
      const claim = await service.createClaim({
        projectId,
        text: 'Claim',
        method: 'deterministic',
      });
      const foreignEvidenceId = await seedEvidence(other.projectId, other.orgId);
      await expect(
        service.linkEvidenceToClaim({
          projectId,
          evidenceId: foreignEvidenceId,
          claimId: claim.id,
          stance: 'supports',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
    });
  },
);
