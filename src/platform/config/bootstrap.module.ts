import { Module } from '@nestjs/common';
import { L0Module } from '../../l0/l0.module';
import { LoggerModule } from '../logging/logger.module';
import { BootstrapValidationService } from './bootstrap-validation.service';
import { ConfigModule } from './config.module';
import { MigrationReadinessService } from './migration-readiness.service';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [ConfigModule, L0Module, LoggerModule],
  providers: [
    MigrationReadinessService,
    ReadinessService,
    BootstrapValidationService,
  ],
  exports: [
    MigrationReadinessService,
    ReadinessService,
    BootstrapValidationService,
  ],
})
export class BootstrapModule {}
