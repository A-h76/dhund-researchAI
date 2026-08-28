import { GenericContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { RedisCacheAdapter } from '../../src/l0/adapters/redis/redis-cache.adapter';
import { S3ObjectStorageAdapter } from '../../src/l0/adapters/s3-compatible/s3-object-storage.adapter';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

(integrationEnabled ? describe : describe.skip)('L0 adapters (integration)', () => {
  jest.setTimeout(180_000);

  it('connects to Postgres via Prisma adapter', async () => {
    const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();

    process.env.DATABASE_URL = postgres.getConnectionUri();

    const adapter = new PrismaDatabaseAdapter();
    await expect(adapter.connect('test-correlation')).resolves.toBeUndefined();
    await expect(adapter.ping()).resolves.toBe(true);
    await adapter.disconnect('test-correlation');

    await postgres.stop();
  });

  it('sets and gets Redis cache values with org namespace', async () => {
    const redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

    const adapter = new RedisCacheAdapter();
    await adapter.connect('test-correlation');
    await adapter.set('org-a', 'token', 'value-1');
    await expect(adapter.get('org-a', 'token')).resolves.toBe('value-1');
    await expect(adapter.get('org-b', 'token')).resolves.toBeNull();
    await adapter.disconnect('test-correlation');

    await redis.stop();
  });

  it('performs MinIO presigned PUT/GET round trip', async () => {
    const minio = await new GenericContainer('minio/minio:latest')
      .withCommand(['server', '/data'])
      .withEnvironment({
        MINIO_ROOT_USER: 'minioadmin',
        MINIO_ROOT_PASSWORD: 'minioadmin',
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    process.env.S3_ENDPOINT = endpoint;
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 'minioadmin';
    process.env.S3_SECRET_ACCESS_KEY = 'minioadmin';
    process.env.S3_BUCKET = 'dhund-test';

    const adapter = new S3ObjectStorageAdapter();
    await adapter.connect('test-correlation');

    const key = adapter.generateObjectKey('org1', 'proj1', 'docs', 'doc1', 'test.txt');
    const putUrl = await adapter.getPresignedPutUrl(key, 300);
    const payload = 'integration-test-payload';

    const putResponse = await fetch(putUrl, {
      method: 'PUT',
      body: payload,
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(putResponse.ok).toBe(true);

    const getUrl = await adapter.getPresignedGetUrl(key, 300);
    const getResponse = await fetch(getUrl);
    expect(getResponse.ok).toBe(true);
    await expect(getResponse.text()).resolves.toBe(payload);

    await adapter.disconnect('test-correlation');
    await minio.stop();
  });
});
