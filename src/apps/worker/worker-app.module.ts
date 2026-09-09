import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import {
  BootstrapValidationService,
  PROCESSOR_READINESS,
  provideRuntimeRole,
} from '../../platform/config';
import { ExtractModule } from '../../ingestion/extract.module';
import { PlatformModule } from '../../platform/platform.module';
import { RuntimeRole } from '../../platform/runtime/role';
import { ExtractProcessor } from './extract.processor';
import { OrphanSweepProcessor } from './orphan-sweep.processor';
import { OutboxRelayProcessor } from './outbox-relay.processor';
import { PlaceholderProcessor } from './placeholder.processor';
import { ProcessorRegistry } from './processor-registry';
import { ProjectDeletionProcessor } from './project-deletion.processor';
import { ReaperProcessor } from './reaper.processor';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [PlatformModule, AiModule, ExtractModule],
  providers: [
    provideRuntimeRole(RuntimeRole.Worker),
    ProcessorRegistry,
    PlaceholderProcessor,
    ExtractProcessor,
    ReaperProcessor,
    OutboxRelayProcessor,
    OrphanSweepProcessor,
    ProjectDeletionProcessor,
    { provide: PROCESSOR_READINESS, useExisting: ProcessorRegistry },
    BootstrapValidationService,
    WorkerBootstrapService,
  ],
})
export class WorkerAppModule {}
