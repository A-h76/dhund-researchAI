import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function isAppendOnlyViolation(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /append-only|update rejected|delete rejected/i.test(msg);
}

(integrationEnabled ? describe : describe.skip)('DHB-18 audit_events append-only', () => {
  jest.setTimeout(180_000);

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
    if (stop) {
      await stop();
    }
  });

  it('rejects DELETE and every UPDATE except actor_id', async () => {
    const id = generateId();
    const actorId = generateId();
    const correlationId = generateId();
    const target = generateId();
    await prisma.auditEvent.create({
      data: {
        id,
        actorType: 'user',
        actorId,
        action: 'projects.project.deleted',
        scope: { target, actor: actorId },
        correlationId,
      },
    });

    await expect(prisma.auditEvent.delete({ where: { id } })).rejects.toThrow(
      /append-only|delete rejected/i,
    );
    await expect(
      prisma.auditEvent.update({ where: { id }, data: { action: 'changed' } }),
    ).rejects.toThrow(/append-only|update rejected/i);

    await prisma.auditEvent.update({ where: { id }, data: { actorId: null } });
    const row = await prisma.auditEvent.findUniqueOrThrow({ where: { id } });
    expect(row.actorId).toBeNull();
    expect(row.action).toBe('projects.project.deleted');
    expect(row.correlationId).toBe(correlationId);
    expect(row.scope).toEqual({ target, actor: actorId });
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(isAppendOnlyViolation(new Error('unrelated'))).toBe(false);
  });
});
