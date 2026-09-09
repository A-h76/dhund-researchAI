import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging';
import { DeletionMetrics } from '../../src/platform/persistence/deletion.metrics';
import { ProjectErasureService } from '../../src/platform/persistence/project-erasure.service';
import {
  BACKUP_RETENTION_DAYS,
  isErasureComplete,
} from '../../src/l0/ports/project-erasure.port';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';
import { MemoryProjectErasureStore } from '../fixtures/memory-erasure-store';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

describe('DHB-39 project erasure job', () => {
  const projectId = generateId();
  const orgId = generateId();
  let storage: MemoryObjectStorage;
  let store: MemoryProjectErasureStore;
  let service: ProjectErasureService;

  beforeEach(() => {
    storage = new MemoryObjectStorage();
    store = new MemoryProjectErasureStore();
    service = new ProjectErasureService(
      store,
      storage,
      new DeletionMetrics(stubLogger()),
      stubLogger(),
    );
    store.tombstone = {
      id: projectId,
      orgId,
      deletedAt: new Date(),
    };
  });

  it('shreds known keys, sweeps leftover prefix objects, and anonymises actors', async () => {
    const owned = `${orgId}/${projectId}/docs/${generateId()}/paper.pdf`;
    const orphan = `${orgId}/${projectId}/tmp/orphan.bin`;
    store.storageKeys = [owned];
    store.actorUpdates = 3;
    store.ownedStampCount = 2;
    storage.put(owned);
    storage.put(orphan);

    const result = await service.run(projectId);

    expect(result.noop).toBe(false);
    expect(result.bytesShredded).toBe(1);
    expect(result.orphansRemoved).toBe(1);
    expect(result.actorsAnonymised).toBe(3);
    expect(result.ownedRowsTombstoned).toBe(2);
    expect(result.erasureComplete).toBe(false);
    expect(storage.objects.size).toBe(0);
    expect(new Date(result.backupTailEndsAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('is a no-op when the project is not tombstoned', async () => {
    store.tombstone = null;
    const result = await service.run(projectId);
    expect(result.noop).toBe(true);
    expect(result.bytesShredded).toBe(0);
  });

  it('re-runs as a no-op on already shredded objects', async () => {
    const key = `${orgId}/${projectId}/docs/a.pdf`;
    store.storageKeys = [key];
    storage.put(key);
    await service.run(projectId);
    const second = await service.run(projectId);
    expect(storage.objects.size).toBe(0);
    expect(second.noop).toBe(false);
    expect(second.actorsAnonymised).toBe(0);
  });

  it('leaves the tombstone in place when object storage fails', async () => {
    store.storageKeys = [`${orgId}/${projectId}/docs/a.pdf`];
    storage.put(store.storageKeys[0]);
    storage.failDeletes = true;
    await expect(service.run(projectId)).rejects.toMatchObject({
      code: 'L0_OPERATION_ERROR',
    });
    expect(store.tombstone).not.toBeNull();
    expect(store.anonymiseCalls).toBe(0);
  });

  it('does not treat shred as erasure complete until the 30-day tail', () => {
    expect(BACKUP_RETENTION_DAYS).toBe(30);
    const deletedAt = new Date('2026-01-01T00:00:00.000Z');
    expect(isErasureComplete(deletedAt, new Date('2026-01-15T00:00:00.000Z'))).toBe(
      false,
    );
    expect(isErasureComplete(deletedAt, new Date('2026-01-31T00:00:00.000Z'))).toBe(
      true,
    );
  });
});
