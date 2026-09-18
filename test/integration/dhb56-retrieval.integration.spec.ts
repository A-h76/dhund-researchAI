import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { authzRecheck } from '../../src/retrieval/authz-recheck';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)('DHB-56 post-fusion authz re-check', () => {
  jest.setTimeout(360_000);

  let prisma: PrismaClient;
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
    if (stop !== undefined) {
      await stop();
    }
  });

  async function seedProject(name: string): Promise<{ orgId: string; projectId: string }> {
    const orgId = generateId();
    const projectId = generateId();
    await prisma.organization.create({ data: { id: orgId, kind: 'TEAM', name } });
    await prisma.project.create({ data: { id: projectId, orgId, name } });
    return { orgId, projectId };
  }

  async function seedChunk(input: {
    readonly orgId: string;
    readonly projectId: string;
    readonly title: string;
    readonly deleted?: boolean;
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
        storageKey: `doc/${documentId}`,
        status: 'completed',
        deletedAt: input.deleted === true ? new Date() : null,
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
        charSpan: { start: 0, end: 8 },
        tokenCount: 2,
        blockIds: [],
        contentHash: `hash-${chunkId}`,
        chunkerVersion: 'v1',
        text: input.title,
      },
    });
    return { documentId, chunkId };
  }

  it('drops cross-project candidates and does not re-evaluate eligibility', async () => {
    const a = await seedProject('A');
    const b = await seedProject('B');
    const live = await seedChunk({ orgId: a.orgId, projectId: a.projectId, title: 'Live A' });
    const deleted = await seedChunk({
      orgId: a.orgId,
      projectId: a.projectId,
      title: 'Deleted A',
      deleted: true,
    });
    const other = await seedChunk({ orgId: b.orgId, projectId: b.projectId, title: 'Live B' });

    expect(await prisma.document.count({ where: { id: deleted.documentId } })).toBe(1);

    const surviving = authzRecheck(
      [
        { projectId: a.projectId, chunkId: live.chunkId },
        { projectId: a.projectId, chunkId: deleted.chunkId },
        { projectId: b.projectId, chunkId: other.chunkId },
      ],
      a.projectId,
    );

    expect(surviving.map((row) => row.chunkId).sort()).toEqual(
      [live.chunkId, deleted.chunkId].sort(),
    );
    expect(surviving.some((row) => row.chunkId === other.chunkId)).toBe(false);
  });
});
