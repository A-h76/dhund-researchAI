import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { IngestionModule } from '../../ingestion/ingestion.module';
import {
  BootstrapValidationService,
  PROCESSOR_READINESS,
  provideRuntimeRole,
} from '../../platform/config';
import { PlatformModule } from '../../platform/platform.module';
import { RuntimeRole } from '../../platform/runtime/role';
import { ExtractProcessor } from './extract.processor';
import { PlaceholderProcessor } from './placeholder.processor';
import { ProcessorRegistry } from './processor-registry';
import { ReaperProcessor } from './reaper.processor';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [PlatformModule, AiModule, IngestionModule],
  providers: [
    provideRuntimeRole(RuntimeRole.Worker),
    ProcessorRegistry,
    PlaceholderProcessor,
    ReaperProcessor,
    ExtractProcessor,
    { provide: PROCESSOR_READINESS, useExisting: ProcessorRegistry },
    BootstrapValidationService,
    WorkerBootstrapService,
  ],
})
export class WorkerAppModule {}
