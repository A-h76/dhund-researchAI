import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging';
import { LARGE_RECLAIM_ORPHAN_COUNT } from '../../src/platform/persistence/orphan-sweep.constants';
import { OrphanSweepMetrics } from '../../src/platform/persistence/orphan-sweep.metrics';
import { OrphanSweepSchedulerService } from '../../src/platform/persistence/orphan-sweep.scheduler';
import { OrphanSweepService } from '../../src/platform/persistence/orphan-sweep.service';
import type { JobEnqueueService } from '../../src/platform/logging';
import type { LeaseService } from '../../src/l0/ports';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';
import { MemoryOrphanSweepStore } from '../fixtures/memory-orphan-sweep-store';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

describe('DHB-49 orphan sweep', () => {
  const orgId = generateId();
  const projectId = generateId();
  const documentId = generateId();
  const olderThan = new Date('2026-01-01T00:00:00.000Z');

  let storage: MemoryObjectStorage;
  let store: MemoryOrphanSweepStore;
  let metrics: OrphanSweepMetrics;
  let service: OrphanSweepService;

  beforeEach(() => {
    storage = new MemoryObjectStorage();
    store = new MemoryOrphanSweepStore();
    metrics = new OrphanSweepMetrics(stubLogger());
    service = new OrphanSweepService(store, storage, metrics);
    store.seedLive({
      id: documentId,
      projectId,
      orgId,
      status: 'completed',
      storageKey: `${orgId}/${projectId}/docs/${documentId}/owned.pdf`,
    });
  });

  it('removes unowned bytes and leaves owned bytes intact', async () => {
    const owned = `${orgId}/${projectId}/docs/${documentId}/owned.pdf`;
    const orphan = `${orgId}/${projectId}/uploads/${generateId()}/abandoned.pdf`;
    storage.put(owned, 'owned-bytes', new Date('2025-12-01T00:00:00.000Z'));
    storage.put(orphan, 'orphan-bytes', new Date('2025-12-01T00:00:00.000Z'));

    const result = await service.run(olderThan);

    expect(result.aborted).toBe(false);
    expect(result.orphanCount).toBe(1);
    expect(result.bytesReclaimed).toBe(Buffer.byteLength('orphan-bytes'));
    expect(storage.objects.has(owned)).toBe(true);
    expect(storage.objects.has(orphan)).toBe(false);
    expect(metrics.snapshot().completed).toBe(1);
  });

  it('re-runs as a no-op after orphans are gone', async () => {
    const owned = `${orgId}/${projectId}/docs/${documentId}/owned.pdf`;
    const orphan = `${orgId}/${projectId}/tmp/leftover.bin`;
    storage.put(owned, 'owned', new Date('2025-12-01T00:00:00.000Z'));
    storage.put(orphan, 'x', new Date('2025-12-01T00:00:00.000Z'));
    await service.run(olderThan);
    const second = await service.run(olderThan);
    expect(second.aborted).toBe(false);
    expect(second.orphanCount).toBe(0);
    expect(second.bytesReclaimed).toBe(0);
    expect(storage.objects.has(owned)).toBe(true);
    expect(storage.objects.has(orphan)).toBe(false);
  });

  it('does not delete bytes when the ownership query is incomplete', async () => {
    store.failOwnedQuery = true;
    const orphan = `${orgId}/${projectId}/tmp/keep.bin`;
    storage.put(orphan, 'keep', new Date('2025-12-01T00:00:00.000Z'));

    const result = await service.run(olderThan);

    expect(result.aborted).toBe(true);
    expect(result.bytesReclaimed).toBe(0);
    expect(storage.objects.has(orphan)).toBe(true);
    expect(metrics.snapshot().aborted).toBe(1);
    expect(metrics.snapshot().completed).toBe(0);
  });

  it('does not delete bytes when object listing fails', async () => {
    storage.failLists = true;
    storage.put(`${orgId}/${projectId}/tmp/keep.bin`, 'keep', new Date('2025-12-01T00:00:00.000Z'));

    const result = await service.run(olderThan);

    expect(result.aborted).toBe(true);
    expect(result.bytesReclaimed).toBe(0);
    expect(storage.objects.size).toBe(1);
  });

  it('skips objects newer than the cutoff and protects in-flight upload keys', async () => {
    const fresh = `${orgId}/${projectId}/tmp/fresh.bin`;
    const sessionKey = `${orgId}/${projectId}/uploads/${generateId()}/in-flight.pdf`;
    storage.put(fresh, 'fresh', new Date('2026-06-01T00:00:00.000Z'));
    storage.put(sessionKey, 'session', new Date('2025-12-01T00:00:00.000Z'));
    store.seedSession({
      storageKey: sessionKey,
      status: 'issued',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });

    const result = await service.run(olderThan);

    expect(result.orphanCount).toBe(0);
    expect(storage.objects.has(fresh)).toBe(true);
    expect(storage.objects.has(sessionKey)).toBe(true);
  });

  it('treats tombstoned document bytes as orphans', async () => {
    const owned = `${orgId}/${projectId}/docs/${documentId}/owned.pdf`;
    storage.put(owned, 'gone', new Date('2025-12-01T00:00:00.000Z'));
    store.tombstone(documentId);

    const result = await service.run(olderThan);

    expect(result.orphanCount).toBe(1);
    expect(storage.objects.has(owned)).toBe(false);
  });

  it('warns when an unexpectedly large reclaim is recorded', () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger;
    const noisy = new OrphanSweepMetrics(logger);
    noisy.recordCompleted({
      bytesReclaimed: 99,
      orphanCount: LARGE_RECLAIM_ORPHAN_COUNT,
      durationMs: 12,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips the sweep when another worker already holds the tick lease', async () => {
    const enqueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    const leases = {
      tryAcquire: jest.fn().mockResolvedValue('contended'),
    };
    const scheduler = new OrphanSweepSchedulerService(
      enqueue as unknown as JobEnqueueService,
      service,
      leases as unknown as LeaseService,
      stubLogger(),
    );
    storage.put(`${orgId}/${projectId}/tmp/orphan.bin`, 'x', new Date('2025-12-01T00:00:00.000Z'));

    await scheduler.scheduleTick(Date.parse('2026-01-01T00:00:00.000Z'));

    expect(enqueue.enqueue).toHaveBeenCalledWith(
      'orphan-sweep',
      expect.objectContaining({ olderThan: '2026-01-01T00:00:00.000Z' }),
    );
    expect(storage.objects.size).toBe(1);
  });
});
