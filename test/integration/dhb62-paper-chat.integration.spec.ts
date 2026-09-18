import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function isCheckViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /check constraint|violates check/i.test(msg);
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /23505|unique|duplicate key/i.test(msg);
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

async function expectRejectsUnique(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected unique violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected unique violation') {
      throw error;
    }
    expect(isUniqueViolation(error)).toBe(true);
  }
}

(integrationEnabled ? describe : describe.skip)(
  'DHB-62 conversation constraints (integration)',
  () => {
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

    async function seedConversation(): Promise<{
      projectId: string;
      conversationId: string;
      orgId: string;
    }> {
      const userId = generateId();
      const orgId = generateId();
      const projectId = generateId();
      const conversationId = generateId();
      await prisma.user.create({
        data: { id: userId, email: `dhb62-${userId}@example.com`, displayName: 'Chat' },
      });
      await prisma.organization.create({
        data: { id: orgId, kind: 'TEAM', name: 'DHB-62' },
      });
      await prisma.project.create({ data: { id: projectId, orgId, name: 'Chat' } });
      await prisma.conversation.create({
        data: { id: conversationId, projectId, createdBy: userId, title: 'Paper' },
      });
      return { projectId, conversationId, orgId };
    }

    it('rejects complete assistant message without ai_execution_id', async () => {
      const { conversationId } = await seedConversation();
      await expectRejectsCheck(() =>
        prisma.message.create({
          data: {
            id: generateId(),
            conversationId,
            role: 'assistant',
            content: 'ungrounded',
            status: 'complete',
            sequence: 1,
          },
        }),
      );
    });

    it('rejects (conversation_id, sequence) collision', async () => {
      const { conversationId } = await seedConversation();
      await prisma.message.create({
        data: {
          id: generateId(),
          conversationId,
          role: 'user',
          content: 'one',
          status: 'complete',
          sequence: 1,
        },
      });
      await expectRejectsUnique(() =>
        prisma.message.create({
          data: {
            id: generateId(),
            conversationId,
            role: 'user',
            content: 'two',
            status: 'complete',
            sequence: 1,
          },
        }),
      );
    });
  },
);
