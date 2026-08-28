import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  CACHE_SERVICE,
  DATABASE_SERVICE,
  type CacheService,
  type DatabaseService,
} from '../../l0/ports';
import { PlatformLogger } from '../logging';
import { RuntimeRole } from '../runtime/role';
import { APP_CONFIG, type FrozenAppConfig } from './config.tokens';
import { assertEmbeddingPolicy } from './embed-policy';
import { MigrationReadinessService } from './migration-readiness.service';
import {
  PROCESSOR_READINESS,
  type ProcessorReadinessProbe,
} from './processor-readiness.port';
import { RUNTIME_ROLE } from './runtime-role.token';

@Injectable()
export class BootstrapValidationService implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_CONFIG) private readonly config: FrozenAppConfig,
    @Inject(DATABASE_SERVICE) private readonly database: DatabaseService,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    private readonly migrations: MigrationReadinessService,
    @Inject(PROCESSOR_READINESS)
    private readonly processors: ProcessorReadinessProbe,
    private readonly logger: PlatformLogger,
    @Inject(RUNTIME_ROLE) private readonly role: RuntimeRole,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    assertEmbeddingPolicy(this.config, undefined);

    this.logger.info({
      module: 'boot',
      message: 'config.loaded',
      keys: this.config.loadedKeyNames,
    });

    try {
      await this.database.ping();
      await this.cache.ping();

      const migrationsReady = await this.migrations.isReady();
      if (!migrationsReady) {
        throw new Error('Database migrations are not fully applied');
      }

      if (this.role === RuntimeRole.Worker && !this.processors.hasProcessors()) {
        throw new Error('Worker processors are not registered');
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Bootstrap validation failed';
      this.logger.error({
        module: 'boot',
        message: 'bootstrap.validation.failed',
        reason,
      });
      process.exit(1);
    }
  }
}
