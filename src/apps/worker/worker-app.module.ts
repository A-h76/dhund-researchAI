import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { EvidenceModule } from '../../evidence/evidence.module';
import { IngestionModule } from '../../ingestion/ingestion.module';
import {
  BootstrapValidationService,
  PROCESSOR_READINESS,
  provideRuntimeRole,
} from '../../platform/config';
import { PlatformModule } from '../../platform/platform.module';
import { RuntimeRole } from '../../platform/runtime/role';
import { ExtractProcessor } from './extract.processor';
import { EvidenceExtractJobConsumer } from './evidence-extract-job.consumer';
import { EvidenceExtractProcessor } from './evidence-extract.processor';
import { EvidenceExtractService } from './evidence-extract.service';
import { PlaceholderProcessor } from './placeholder.processor';
import { ProcessorRegistry } from './processor-registry';
import { ReaperProcessor } from './reaper.processor';
import { StanceJobConsumer } from './stance-job.consumer';
import { StanceProcessor } from './stance.processor';
import { StanceService } from './stance.service';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [PlatformModule, AiModule, IngestionModule, EvidenceModule],
  providers: [
    provideRuntimeRole(RuntimeRole.Worker),
    ProcessorRegistry,
    PlaceholderProcessor,
    ReaperProcessor,
    ExtractProcessor,
    EvidenceExtractService,
    EvidenceExtractJobConsumer,
    EvidenceExtractProcessor,
    StanceService,
    StanceJobConsumer,
    StanceProcessor,
    { provide: PROCESSOR_READINESS, useExisting: ProcessorRegistry },
    BootstrapValidationService,
    WorkerBootstrapService,
  ],
})
export class WorkerAppModule {}
