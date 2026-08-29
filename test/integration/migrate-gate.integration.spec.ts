import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)(
  'prisma migrate gate (DHB-28)',
  () => {
    jest.setTimeout(180_000);

    it('applies migrations to an empty disposable Postgres and re-applies as a no-op', async () => {
      const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
      const databaseUrl = postgres.getConnectionUri();

      try {
        const first = execSync('npx prisma migrate deploy', {
          cwd: ROOT,
          env: { ...process.env, DATABASE_URL: databaseUrl },
          encoding: 'utf8',
        });
        expect(first.toLowerCase()).toContain('applied');

        const second = execSync('npx prisma migrate deploy', {
          cwd: ROOT,
          env: { ...process.env, DATABASE_URL: databaseUrl },
          encoding: 'utf8',
        });
        expect(second.toLowerCase()).toMatch(/already|no pending|up to date|applied/);

        const status = execSync('npx prisma migrate status', {
          cwd: ROOT,
          env: { ...process.env, DATABASE_URL: databaseUrl },
          encoding: 'utf8',
        });
        expect(status.toLowerCase()).toMatch(/database schema is up to date|no pending/);
      } finally {
        await postgres.stop();
      }
    });
  },
);
