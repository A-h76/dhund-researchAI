import { Inject, Injectable } from '@nestjs/common';
import {
  OBJECT_STORAGE_SERVICE,
  PROJECT_ERASURE_STORE,
  isErasureComplete,
  backupTailEndsAt,
  type ObjectStorageService,
  type ProjectErasureStore,
} from '../../l0/ports';
import { PlatformLogger } from '../logging';
import { DeletionMetrics } from './deletion.metrics';

export interface ProjectErasureResult {
  readonly projectId: string;
  readonly bytesShredded: number;
  readonly orphansRemoved: number;
  readonly actorsAnonymised: number;
  readonly ownedRowsTombstoned: number;
  readonly erasureComplete: boolean;
  readonly backupTailEndsAt: string;
  readonly noop: boolean;
}

@Injectable()
export class ProjectErasureService {
  constructor(
    @Inject(PROJECT_ERASURE_STORE) private readonly store: ProjectErasureStore,
    @Inject(OBJECT_STORAGE_SERVICE) private readonly storage: ObjectStorageService,
    private readonly metrics: DeletionMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async run(projectId: string): Promise<ProjectErasureResult> {
    const project = await this.store.findTombstonedProject(projectId);
    if (project === null) {
      this.logger.info({
        module: 'projects',
        message: 'deletion.job.noop',
        projectId,
      });
      return {
        projectId,
        bytesShredded: 0,
        orphansRemoved: 0,
        actorsAnonymised: 0,
        ownedRowsTombstoned: 0,
        erasureComplete: false,
        backupTailEndsAt: backupTailEndsAt(new Date(0)).toISOString(),
        noop: true,
      };
    }

    try {
      const ownedRowsTombstoned = await this.store.stampOwnedDeletedAt(projectId);
      const keys = await this.store.listStorageKeys(projectId);
      const bytesShredded = await this.shred(keys);
      const orphansRemoved = await this.sweepOrphans(project.orgId, project.id);
      const actorsAnonymised = await this.store.anonymiseAuditActors(projectId);
      const erasureComplete = isErasureComplete(project.deletedAt);
      const tail = backupTailEndsAt(project.deletedAt).toISOString();

      this.metrics.recordJob({
        bytesShredded,
        orphansRemoved,
        actorsAnonymised,
        erasureComplete,
      });
      this.logger.info({
        module: 'projects',
        message: 'deletion.job.completed',
        projectId,
        bytesShredded,
        orphansRemoved,
        actorsAnonymised,
        ownedRowsTombstoned,
        erasureComplete,
        backupTailEndsAt: tail,
      });

      return {
        projectId,
        bytesShredded,
        orphansRemoved,
        actorsAnonymised,
        ownedRowsTombstoned,
        erasureComplete,
        backupTailEndsAt: tail,
        noop: false,
      };
    } catch (error) {
      this.metrics.recordFailure();
      this.logger.error({
        module: 'projects',
        message: 'deletion.job.failed',
        projectId,
      });
      throw error;
    }
  }

  private async shred(keys: readonly string[]): Promise<number> {
    let shredded = 0;
    for (const key of keys) {
      await this.storage.delete(key);
      shredded += 1;
    }
    return shredded;
  }

  private async sweepOrphans(orgId: string, projectId: string): Promise<number> {
    const leftover = await this.storage.listKeys(`${orgId}/${projectId}/`);
    for (const key of leftover) {
      await this.storage.delete(key);
    }
    return leftover.length;
  }
}
