import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import {
  BootstrapValidationService,
  PROCESSOR_READINESS,
  provideRuntimeRole,
} from '../../platform/config';
import { PlatformModule } from '../../platform/platform.module';
import { RuntimeRole } from '../../platform/runtime/role';
import { PlaceholderProcessor } from './placeholder.processor';
import { ProcessorRegistry } from './processor-registry';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [PlatformModule, AiModule],
  providers: [
    provideRuntimeRole(RuntimeRole.Worker),
    ProcessorRegistry,
    PlaceholderProcessor,
    { provide: PROCESSOR_READINESS, useExisting: ProcessorRegistry },
    BootstrapValidationService,
    WorkerBootstrapService,
  ],
})
export class WorkerAppModule {}
