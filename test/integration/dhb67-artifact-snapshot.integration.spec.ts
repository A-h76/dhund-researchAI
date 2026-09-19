import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  emptyResearchRunCoverage,
  hashResearchRunCoverage,
  type ResearchRunCoverage,
} from '../../src/l0/ports/research-run-coverage';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

const coverageA: ResearchRunCoverage = {
  schemaVersion: 1,
  discovery: {
    requested: 5,
    discovered: 5,
    eligible: 5,
    excluded: 0,
    included: 5,
  },
  processing: {
    requested: 5,
    admitted: 5,
    completed: 5,
    partial: 0,
    failed: 0,
    unresolved: 0,
  },
};

const coverageB: ResearchRunCoverage = {
  ...coverageA,
  processing: { ...coverageA.processing, completed: 4, unresolved: 1 },
};

(integrationEnabled ? describe : describe.skip)(
  'DHB-67 artifact coverage snapshot hash (integration)',
  () => {
    jest.setTimeout(360_000);

    let prisma!: PrismaClient;
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
      stop = async () => {
        await prisma.$disconnect();
        await postgres.stop();
      };
    });

    afterAll(async () => {
      await stop?.();
    });

    async function seedRun(): Promise<{
      readonly runId: string;
      readonly aiExecutionId: string;
      readonly orgId: string;
      readonly projectId: string;
    }> {
      const userId = generateId();
      const orgId = generateId();
      const projectId = generateId();
      await prisma.user.create({
        data: { id: userId, email: `${userId}@example.com`, displayName: 't' },
      });
      await prisma.organization.create({
        data: { id: orgId, kind: 'PERSONAL', name: 'org', ownerUserId: userId },
      });
      await prisma.project.create({
        data: { id: projectId, orgId, name: 'p' },
      });
      const runId = generateId();
      await prisma.researchRun.create({
        data: {
          id: runId,
          orgId,
          projectId,
          initiatedBy: userId,
          preset: 'deep_research',
          reservedMicros: 1_000_000n,
          idempotencyKey: generateId(),
          coverage: coverageA as object,
        },
      });
      const aiExecutionId = generateId();
      await prisma.aiExecution.create({
        data: {
          id: aiExecutionId,
          orgId,
          projectId,
          researchRunId: runId,
          capability: 'SYNTHESIS',
          provider: 'stub',
          model: 'stub',
          promptVersion: 'v1',
          inputFingerprint: 'fp',
          status: 'ok',
          method: 'llm',
          correlationId: generateId(),
        },
      });
      return { runId, aiExecutionId, orgId, projectId };
    }

    it('stores frozen snapshot hash; identical coverage shares hash, changed coverage differs', async () => {
      const { runId, aiExecutionId } = await seedRun();
      const hashA = hashResearchRunCoverage(coverageA);
      const hashA2 = hashResearchRunCoverage(coverageA);
      const hashB = hashResearchRunCoverage(coverageB);
      expect(hashA).toBe(hashA2);
      expect(hashB).not.toBe(hashA);

      await prisma.researchArtifact.create({
        data: {
          id: generateId(),
          runId,
          type: 'deep_research_report',
          coverageSnapshot: coverageA as object,
          coverageSnapshotHash: hashA,
          generatedAt: new Date(),
          aiExecutionId,
        },
      });

      // Later run coverage mutation must not alter the stored snapshot.
      await prisma.researchRun.update({
        where: { id: runId },
        data: { coverage: emptyResearchRunCoverage() as object },
      });
      const artifact = await prisma.researchArtifact.findFirstOrThrow({
        where: { runId },
      });
      expect(artifact.coverageSnapshotHash).toBe(hashA);
      expect(artifact.coverageSnapshot).toEqual(coverageA);
      expect(artifact.aiExecutionId).toBe(aiExecutionId);

      await expect(
        prisma.researchArtifact.create({
          data: {
            id: generateId(),
            runId,
            type: 'deep_research_report',
            coverageSnapshot: coverageB as object,
            coverageSnapshotHash: hashB,
            generatedAt: new Date(),
            aiExecutionId,
          },
        }),
      ).resolves.toBeDefined();
    });

    it('keeps partial-run provenance intact for processed documents (evidence aiExecutionId)', async () => {
      const { runId, aiExecutionId, projectId } = await seedRun();
      const sourceId = generateId();
      await prisma.source.create({
        data: {
          id: sourceId,
          projectId,
          type: 'document',
        },
      });
      const evidenceId = generateId();
      await prisma.evidence.create({
        data: {
          id: evidenceId,
          projectId,
          sourceId,
          locator: { page: 1 },
          text: 'processed under partial coverage',
          qualityScore: 1,
          extractionMethod: 'llm',
          type: 'body_grounded',
          aiExecutionId,
        },
      });

      await prisma.researchRun.update({
        where: { id: runId },
        data: {
          state: 'COMPLETED_PARTIAL',
          coverage: {
            schemaVersion: 1,
            discovery: coverageA.discovery,
            processing: {
              requested: 5,
              admitted: 5,
              completed: 1,
              partial: 0,
              failed: 0,
              unresolved: 4,
            },
          } as object,
        },
      });

      const evidence = await prisma.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
      expect(evidence.aiExecutionId).toBe(aiExecutionId);
      expect(evidence.text).toContain('partial coverage');
      const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
      expect(run.state).toBe('COMPLETED_PARTIAL');
      expect((run.coverage as unknown as ResearchRunCoverage).processing.completed).toBe(1);
    });
  },
);
