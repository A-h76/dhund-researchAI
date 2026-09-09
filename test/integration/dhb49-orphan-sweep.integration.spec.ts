import { GenericContainer, Wait } from 'testcontainers';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging';
import { OrphanSweepMetrics } from '../../src/platform/persistence/orphan-sweep.metrics';
import { OrphanSweepService } from '../../src/platform/persistence/orphan-sweep.service';
import { S3ObjectStorageAdapter } from '../../src/l0/adapters/s3-compatible/s3-object-storage.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { MemoryOrphanSweepStore } from '../fixtures/memory-orphan-sweep-store';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

(integrationEnabled ? describe : describe.skip)('DHB-49 orphan sweep (MinIO)', () => {
  jest.setTimeout(180_000);

  it('removes unowned MinIO bytes, leaves owned bytes, and re-runs as a no-op', async () => {
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
    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: 'postgres://localhost:5432/dhund',
      redisUrl: 'redis://localhost:6379',
      databasePoolSize: 10,
      s3: {
        endpoint,
        region: 'us-east-1',
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        bucket: 'dhund-orphan-sweep',
      },
    };

    const adapter = new S3ObjectStorageAdapter(connectionConfig);
    await adapter.connect('test-correlation');

    const orgId = generateId();
    const projectId = generateId();
    const documentId = generateId();
    const owned = adapter.generateObjectKey(orgId, projectId, 'docs', documentId, 'owned.pdf');
    const orphan = adapter.generateObjectKey(orgId, projectId, 'uploads', generateId(), 'abandoned.pdf');

    await putObject(adapter, owned, 'owned-bytes');
    await putObject(adapter, orphan, 'orphan-bytes');

    const store = new MemoryOrphanSweepStore();
    store.seedLive({
      id: documentId,
      projectId,
      orgId,
      status: 'completed',
      storageKey: owned,
    });
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as PlatformLogger;
    const service = new OrphanSweepService(store, adapter, new OrphanSweepMetrics(logger));
    const olderThan = new Date(Date.now() + 60_000);

    const first = await service.run(olderThan);
    expect(first.aborted).toBe(false);
    expect(first.orphanCount).toBe(1);
    await expect(adapter.headObject(owned)).resolves.toEqual({
      contentLength: Buffer.byteLength('owned-bytes'),
    });
    await expect(adapter.headObject(orphan)).resolves.toBeNull();

    const second = await service.run(olderThan);
    expect(second.aborted).toBe(false);
    expect(second.orphanCount).toBe(0);
    expect(second.bytesReclaimed).toBe(0);

    await adapter.disconnect('test-correlation');
    await minio.stop();
  });
});

async function putObject(
  adapter: S3ObjectStorageAdapter,
  key: string,
  body: string,
): Promise<void> {
  const url = await adapter.getPresignedPutUrl(key, 300, Buffer.byteLength(body));
  const response = await fetch(url, { method: 'PUT', body });
  expect(response.ok).toBe(true);
}
