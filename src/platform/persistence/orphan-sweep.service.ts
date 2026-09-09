import { Inject, Injectable } from '@nestjs/common';
import {
  OBJECT_STORAGE_SERVICE,
  ORPHAN_SWEEP_STORE,
  type ObjectStorageListing,
  type ObjectStorageService,
  type OrphanSweepStore,
} from '../../l0/ports';
import { OrphanSweepMetrics } from './orphan-sweep.metrics';

export interface OrphanSweepResult {
  readonly aborted: boolean;
  readonly bytesReclaimed: number;
  readonly orphanCount: number;
  readonly durationMs: number;
}

@Injectable()
export class OrphanSweepService {
  constructor(
    @Inject(ORPHAN_SWEEP_STORE) private readonly store: OrphanSweepStore,
    @Inject(OBJECT_STORAGE_SERVICE) private readonly storage: ObjectStorageService,
    private readonly metrics: OrphanSweepMetrics,
  ) {}

  async run(olderThan: Date): Promise<OrphanSweepResult> {
    const started = Date.now();
    const owned = await this.store.listOwnedStorageKeys();
    if (!owned.ok) {
      this.metrics.recordAbort('ownership_incomplete');
      return aborted(started);
    }

    let listings: readonly ObjectStorageListing[];
    try {
      listings = await this.storage.listObjects('');
    } catch {
      this.metrics.recordAbort('list_failed');
      return aborted(started);
    }

    const cutoff = olderThan.getTime();
    const orphans = listings.filter(
      (object) => !owned.keys.has(object.key) && object.lastModified.getTime() <= cutoff,
    );

    let bytesReclaimed = 0;
    for (const object of orphans) {
      await this.storage.delete(object.key);
      bytesReclaimed += object.size;
    }

    const durationMs = Date.now() - started;
    this.metrics.recordCompleted({
      bytesReclaimed,
      orphanCount: orphans.length,
      durationMs,
    });
    return {
      aborted: false,
      bytesReclaimed,
      orphanCount: orphans.length,
      durationMs,
    };
  }
}

function aborted(started: number): OrphanSweepResult {
  return {
    aborted: true,
    bytesReclaimed: 0,
    orphanCount: 0,
    durationMs: Date.now() - started,
  };
}
