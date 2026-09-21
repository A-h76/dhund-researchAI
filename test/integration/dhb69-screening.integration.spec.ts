import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function isAppendOnlyViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /append-only|UPDATE rejected|DELETE rejected/i.test(message);
}

async function expectRejectsAppendOnly(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    throw new Error('expected append-only rejection');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected append-only rejection') {
      throw error;
    }
    expect(isAppendOnlyViolation(error)).toBe(true);
  }
}

(integrationEnabled ? describe : describe.skip)(
  'DHB-69 screening append-only + supersession',
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
      if (stop) await stop();
    });

    async function seed(): Promise<{
      userId: string;
      projectId: string;
      sourceId: string;
    }> {
      const userId = generateId();
      const orgId = generateId();
      const projectId = generateId();
      const documentId = generateId();
      const sourceId = generateId();
      const storageKey = `doc/${generateId()}`;

      await prisma.user.create({
        data: { id: userId, email: `dhb69-${userId}@example.com`, displayName: 'Test' },
      });
      await prisma.organization.create({
        data: { id: orgId, kind: 'PERSONAL', name: 'Personal', ownerUserId: userId },
      });
      await prisma.project.create({ data: { id: projectId, orgId, name: 'Project' } });
      await prisma.document.create({
        data: { id: documentId, projectId, orgId, title: 'Paper', storageKey },
      });
      await prisma.source.create({
        data: { id: sourceId, projectId, documentId, type: 'document' },
      });

      return { userId, projectId, sourceId };
    }

    it('preserves the original decision row on supersession and rejects mutating edits', async () => {
      const { userId, projectId, sourceId } = await seed();
      const originalId = generateId();
      const successorId = generateId();

      await prisma.screeningDecision.create({
        data: {
          id: originalId,
          projectId,
          sourceId,
          decision: 'include',
          reason: 'first pass',
          method: 'deterministic',
          decidedBy: userId,
          decidedAt: new Date(),
        },
      });
      await prisma.screeningDecision.create({
        data: {
          id: successorId,
          projectId,
          sourceId,
          decision: 'exclude',
          reason: 'reversed',
          method: 'deterministic',
          decidedBy: userId,
          decidedAt: new Date(),
        },
      });
      await prisma.screeningDecision.update({
        where: { id: originalId },
        data: { supersededByDecisionId: successorId },
      });

      const original = await prisma.screeningDecision.findUniqueOrThrow({
        where: { id: originalId },
      });
      expect(original.decision).toBe('include');
      expect(original.reason).toBe('first pass');
      expect(original.method).toBe('deterministic');
      expect(original.supersededByDecisionId).toBe(successorId);

      await expectRejectsAppendOnly(() =>
        prisma.screeningDecision.update({
          where: { id: originalId },
          data: { decision: 'unresolved' },
        }),
      );
      await expectRejectsAppendOnly(() =>
        prisma.screeningDecision.update({
          where: { id: originalId },
          data: { reason: 'tamper' },
        }),
      );
      await expectRejectsAppendOnly(() =>
        prisma.screeningDecision.delete({ where: { id: originalId } }),
      );
    });
  },
);
