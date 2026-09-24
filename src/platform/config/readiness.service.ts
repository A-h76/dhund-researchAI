import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CACHE_SERVICE,
  DATABASE_SERVICE,
  type CacheService,
  type DatabaseService,
} from '../../l0/ports';
import { MetricsSurface } from '../observability/metrics-surface';
import { MigrationReadinessService } from './migration-readiness.service';

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly database: DatabaseService,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    private readonly migrations: MigrationReadinessService,
    @Optional() private readonly metrics?: MetricsSurface,
  ) {}

  async isReady(): Promise<boolean> {
    try {
      await this.database.ping();
      await this.cache.ping();
      this.observePool();
      return await this.migrations.isReady();
    } catch {
      return false;
    }
  }

  private observePool(): void {
    const info = this.database.getPoolInfo();
    if (info.configuredSize <= 0) {
      return;
    }
    this.metrics?.recordDbPool(info.inUse / info.configuredSize);
  }
}
