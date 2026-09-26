import { GenericContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { RedisCacheAdapter } from '../../src/l0/adapters/redis/redis-cache.adapter';
import { S3ObjectStorageAdapter } from '../../src/l0/adapters/s3-compatible/s3-object-storage.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

(integrationEnabled ? describe : describe.skip)('L0 adapters (integration)', () => {
  jest.setTimeout(180_000);

  it('connects to Postgres via Prisma adapter', async () => {
    const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();

    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: postgres.getConnectionUri(),
      redisUrl: 'redis://localhost:6379',
      databasePoolSize: 10,
    };

    const adapter = new PrismaDatabaseAdapter(connectionConfig);
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

    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: 'postgres://localhost:5432/dhund',
      redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      databasePoolSize: 10,
    };

    const adapter = new RedisCacheAdapter(connectionConfig);
    await adapter.connect('test-correlation');
    await expect(adapter.ping()).resolves.toBe(true);
    await adapter.set('org-a', 'token', 'value-1');
    await expect(adapter.get('org-a', 'token')).resolves.toBe('value-1');
    await expect(adapter.get('org-b', 'token')).resolves.toBeNull();
    await adapter.disconnect('test-correlation');

    await redis.stop();
  });

  it('performs MinIO presigned PUT/GET round trip', async () => {
    const minio = await new GenericContainer('quay.io/minio/minio:latest')
      .withCommand(['server', '/data'])
      .withEnvironment({
        MINIO_ROOT_USER: 'minioadmin',
        MINIO_ROOT_PASSWORD: 'minioadmin',
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: 'postgres://localhost:5432/dhund',
      redisUrl: 'redis://localhost:6379',
      databasePoolSize: 10,
      s3: {
        endpoint,
        region: 'us-east-1',
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        bucket: 'dhund-test',
      },
    };

    const adapter = new S3ObjectStorageAdapter(connectionConfig);
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

    await adapter.delete(key);
    const missing = await fetch(await adapter.getPresignedGetUrl(key, 300));
    expect(missing.ok).toBe(false);

    await adapter.disconnect('test-correlation');
    await minio.stop();
  });

  it('enforces key namespace, TTL expiry, maxContentLength, and object reads', async () => {
    const minio = await new GenericContainer('quay.io/minio/minio:latest')
      .withCommand(['server', '/data'])
      .withEnvironment({
        MINIO_ROOT_USER: 'minioadmin',
        MINIO_ROOT_PASSWORD: 'minioadmin',
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: 'postgres://localhost:5432/dhund',
      redisUrl: 'redis://localhost:6379',
      databasePoolSize: 10,
      s3: {
        endpoint,
        region: 'us-east-1',
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        bucket: 'dhund-test',
      },
    };

    const adapter = new S3ObjectStorageAdapter(connectionConfig);
    await adapter.connect('test-correlation');

    const key = adapter.generateObjectKey(
      'org-a',
      'proj-a',
      'uploads',
      'sess-1',
      '../../etc/passwd',
    );
    expect(key).toBe('org-a/proj-a/uploads/sess-1/passwd');

    const limited = await adapter.getPresignedPutUrl(key, 300, 4);
    const oversize = await fetch(limited, { method: 'PUT', body: 'hello' });
    expect(oversize.ok).toBe(false);

    const exact = await fetch(limited, { method: 'PUT', body: 'abcd' });
    expect(exact.ok).toBe(true);
    await expect(adapter.headObject(key)).resolves.toEqual({ contentLength: 4 });
    await expect(adapter.getObjectBytes(key, 4)).resolves.toEqual(Buffer.from('abcd'));

    const ttlKey = adapter.generateObjectKey('org-a', 'proj-a', 'uploads', 'sess-2', 'ttl.txt');
    const shortLived = await adapter.getPresignedPutUrl(ttlKey, 1);
    await new Promise((resolve) => {
      setTimeout(resolve, 2500);
    });
    const expired = await fetch(shortLived, { method: 'PUT', body: 'x' });
    expect(expired.ok).toBe(false);

    await adapter.disconnect('test-correlation');
    await minio.stop();
  });
});
