import { Inject, Injectable } from '@nestjs/common';
import {
  CACHE_SERVICE,
  DATABASE_SERVICE,
  type CacheService,
  type DatabaseService,
} from '../../l0/ports';
import { MigrationReadinessService } from './migration-readiness.service';

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly database: DatabaseService,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    private readonly migrations: MigrationReadinessService,
  ) {}

  async isReady(): Promise<boolean> {
    try {
      await this.database.ping();
      await this.cache.ping();
      return await this.migrations.isReady();
    } catch {
      return false;
    }
  }
}
