import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { generateId } from '../../src/platform/ids';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('DHB-71 R10 external_record_snapshots + stale_at', () => {
  jest.setTimeout(180_000);

  it('rejects UPDATE on snapshots; failed refresh mark uses stale_at without blanking', async () => {
    const pg = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const databaseUrl = pg.getConnectionUri();
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    const userId = generateId();
    const orgId = generateId();
    const projectId = generateId();
    await prisma.user.create({
      data: {
        id: userId,
        email: `u-${userId}@example.com`,
        displayName: 'Tester',
      },
    });
    await prisma.organization.create({
      data: { id: orgId, name: 'org', kind: 'PERSONAL', ownerUserId: userId },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        orgId,
        name: 'p',
      },
    });

    const rightsId = generateId();
    await prisma.rightsSnapshot.create({
      data: {
        id: rightsId,
        connectorId: 'arxiv',
        policyVersion: `v-${generateId().slice(0, 8)}`,
        capabilities: { metadata: true, body: false },
        capturedAt: new Date(),
      },
    });

    const recordId = generateId();
    await prisma.externalRecord.create({
      data: {
        id: recordId,
        projectId,
        connectorId: 'arxiv',
        externalId: `ext-${generateId()}`,
        type: 'web_page',
        rightsSnapshotId: rightsId,
      },
    });

    const snapId = generateId();
    await prisma.externalRecordSnapshot.create({
      data: {
        id: snapId,
        externalRecordId: recordId,
        capturedAt: new Date(),
        metadata: { title: 'n' },
      },
    });

    await expect(
      prisma.externalRecordSnapshot.update({
        where: { id: snapId },
        data: { metadata: { title: 'mutated' } },
      }),
    ).rejects.toThrow(/append-only|UPDATE rejected/i);

    const still = await prisma.externalRecordSnapshot.findUnique({ where: { id: snapId } });
    expect(still?.metadata).toEqual({ title: 'n' });

    const staleAt = new Date();
    await prisma.externalRecord.update({
      where: { id: recordId },
      data: { staleAt },
    });
    const marked = await prisma.externalRecord.findUnique({ where: { id: recordId } });
    expect(marked?.staleAt).not.toBeNull();
    expect(await prisma.externalRecordSnapshot.count({ where: { externalRecordId: recordId } })).toBe(
      1,
    );

    await prisma.$disconnect();
    await pg.stop();
  });
});
