import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaProjectErasureAdapter } from '../../src/l0/adapters/prisma/prisma-project-erasure.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)(
  'DHB-39 erasure Postgres (integration)',
  () => {
    jest.setTimeout(360_000);

    let prisma: PrismaClient;
    let store: PrismaProjectErasureAdapter;
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
      store = new PrismaProjectErasureAdapter(database);
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

    it('anonymises actor_id, keeps the row, and rejects DELETE', async () => {
      const userId = generateId();
      const orgId = generateId();
      const projectId = generateId();
      await prisma.user.create({
        data: { id: userId, email: `dhb39-${userId}@example.com`, displayName: 'Pat' },
      });
      await prisma.organization.create({
        data: { id: orgId, kind: 'TEAM', name: 'Org' },
      });
      await prisma.project.create({
        data: { id: projectId, orgId, name: 'Doomed', deletedAt: new Date() },
      });
      const auditId = generateId();
      await prisma.auditEvent.create({
        data: {
          id: auditId,
          actorType: 'user',
          actorId: userId,
          action: 'projects.project.deleted',
          scope: { projectId, orgId },
          correlationId: generateId(),
        },
      });

      const tombstone = await store.findTombstonedProject(projectId);
      expect(tombstone?.id).toBe(projectId);
      expect(await store.anonymiseAuditActors(projectId)).toBe(1);
      expect(await store.anonymiseAuditActors(projectId)).toBe(0);

      const row = await prisma.auditEvent.findUnique({ where: { id: auditId } });
      expect(row).not.toBeNull();
      expect(row?.actorId).toBeNull();

      await expect(prisma.auditEvent.delete({ where: { id: auditId } })).rejects.toThrow(
        /append-only|DELETE rejected/i,
      );
    });
  },
);
