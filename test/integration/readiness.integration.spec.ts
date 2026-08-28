import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { GenericContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { HealthController } from '../../src/apps/api/health.controller';
import { ConfigModule } from '../../src/platform/config';
import { Test } from '@nestjs/testing';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { correlationExpressMiddleware } from '../../src/platform/logging';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)(
  'readiness integration',
  () => {
    jest.setTimeout(180_000);

    it('flips /ready from unready to ready after migrations are applied', async () => {
      const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
      const redis = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
        .start();

      const databaseUrl = postgres.getConnectionUri();
      const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

      installTestAppConfig({
        databaseUrl,
        redisUrl,
        logLevel: 'silent',
      });

      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule],
        controllers: [HealthController],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.use(correlationExpressMiddleware);
      await app.init();
      await app.listen(0, '127.0.0.1');
      const baseUrl = await app.getUrl();

      try {
        const before = await fetch(`${baseUrl}/ready`);
        expect(before.status).toBe(503);
        expect(await before.json()).toEqual({ status: 'unready' });

        execSync('npx prisma migrate deploy', {
          cwd: ROOT,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
          },
          stdio: 'ignore',
        });

        const after = await fetch(`${baseUrl}/ready`);
        expect(after.status).toBe(200);
        expect(await after.json()).toEqual({ status: 'ready' });
      } finally {
        await app.close();
        await redis.stop();
        await postgres.stop();
      }
    });

    it('returns 503 from /ready when redis becomes unavailable after boot', async () => {
      const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
      const redis = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
        .start();

      const databaseUrl = postgres.getConnectionUri();
      const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

      installTestAppConfig({
        databaseUrl,
        redisUrl,
        logLevel: 'silent',
      });

      execSync('npx prisma migrate deploy', {
        cwd: ROOT,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        stdio: 'ignore',
      });

      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule],
        controllers: [HealthController],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.use(correlationExpressMiddleware);
      await app.init();
      await app.listen(0, '127.0.0.1');
      const baseUrl = await app.getUrl();

      try {
        const ready = await fetch(`${baseUrl}/ready`);
        expect(ready.status).toBe(200);

        await redis.stop();

        const unready = await fetch(`${baseUrl}/ready`);
        expect(unready.status).toBe(503);
        expect(await unready.json()).toEqual({ status: 'unready' });
      } finally {
        await app.close();
        await postgres.stop();
      }
    });
  },
);
