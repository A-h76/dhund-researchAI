import { Module } from '@nestjs/common';
import { OrchestrationModule } from '../../orchestration/orchestration.module';
import {
  PROCESSOR_READINESS,
  provideRuntimeRole,
} from '../../platform/config';
import { PlatformModule } from '../../platform/platform.module';
import { RuntimeRole } from '../../platform/runtime/role';
import { PlaceholderProcessor } from './placeholder.processor';
import { ProcessorRegistry } from './processor-registry';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [PlatformModule, OrchestrationModule],
  providers: [
    provideRuntimeRole(RuntimeRole.Worker),
    ProcessorRegistry,
    PlaceholderProcessor,
    { provide: PROCESSOR_READINESS, useExisting: ProcessorRegistry },
    WorkerBootstrapService,
  ],
})
export class WorkerAppModule {}
