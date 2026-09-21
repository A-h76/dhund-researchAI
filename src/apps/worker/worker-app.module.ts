import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import {
  BootstrapValidationService,
  PROCESSOR_READINESS,
  provideRuntimeRole,
} from '../../platform/config';
import { ChunkModule } from '../../ingestion/chunk.module';
import { EmbedModule } from '../../ai/embed/embed.module';
import { ExtractModule } from '../../ingestion/extract.module';
import { EvidenceModule } from '../../evidence/evidence.module';
import { OcrModule } from '../../ai/ocr/ocr.module';
import { OrchestrationModule } from '../../orchestration/orchestration.module';
import { PlatformModule } from '../../platform/platform.module';
import { RetrievalModule } from '../../retrieval/retrieval.module';
import { RuntimeRole } from '../../platform/runtime/role';
import { ChunkProcessor } from './chunk.processor';
import { EmbedBackfillProcessor } from './embed-backfill.processor';
import { EmbedProcessor } from './embed.processor';
import { ExtractProcessor } from './extract.processor';
import { EvidenceExtractJobConsumer } from './evidence-extract-job.consumer';
import { EvidenceExtractProcessor } from './evidence-extract.processor';
import { EvidenceExtractService } from './evidence-extract.service';
import { OcrProcessor } from './ocr.processor';
import { OrphanSweepProcessor } from './orphan-sweep.processor';
import { OutboxRelayProcessor } from './outbox-relay.processor';
import { PlaceholderProcessor } from './placeholder.processor';
import { ProcessorRegistry } from './processor-registry';
import { ProjectDeletionProcessor } from './project-deletion.processor';
import { ReaperProcessor } from './reaper.processor';
import { ResearchRunStepExecutor } from './research-run-step.executor';
import { ResearchRunStepProcessor } from './research-run-step.processor';
import { ResearchRunTickProcessor } from './research-run-tick.processor';
import { ResearchArtifactGenerateProcessor } from './research-artifact-generate.processor';
import { ExtractionCellProcessor } from './extraction-cell.processor';
import { StanceJobConsumer } from './stance-job.consumer';
import { StanceProcessor } from './stance.processor';
import { StanceService } from './stance.service';
import { SynthesisProcessor } from './synthesis.processor';
import { SynthesisService } from './synthesis.service';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [
    PlatformModule,
    AiModule,
    ExtractModule,
    OcrModule,
    ChunkModule,
    EmbedModule,
    RetrievalModule,
    EvidenceModule,
    OrchestrationModule,
  ],
  providers: [
    provideRuntimeRole(RuntimeRole.Worker),
    ProcessorRegistry,
    PlaceholderProcessor,
    ExtractProcessor,
    OcrProcessor,
    ChunkProcessor,
    EmbedProcessor,
    EmbedBackfillProcessor,
    EvidenceExtractService,
    EvidenceExtractJobConsumer,
    EvidenceExtractProcessor,
    ResearchRunStepExecutor,
    ResearchRunStepProcessor,
    StanceService,
    StanceJobConsumer,
    StanceProcessor,
    SynthesisService,
    SynthesisProcessor,
    ResearchRunTickProcessor,
    ResearchArtifactGenerateProcessor,
    ExtractionCellProcessor,
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
