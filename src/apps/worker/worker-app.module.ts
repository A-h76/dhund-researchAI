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
import { OcrModule } from '../../ai/ocr/ocr.module';
import { BillingModule } from '../../billing/billing.module';
import { BillingQueueConsumer } from '../../billing/billing-queue.consumer';
import { PlatformModule } from '../../platform/platform.module';
import { RetrievalModule } from '../../retrieval/retrieval.module';
import { RuntimeRole } from '../../platform/runtime/role';
import { BillingReconcileProcessor } from './billing-reconcile.processor';
import { BillingSyncProcessor } from './billing-sync.processor';
import { ChunkProcessor } from './chunk.processor';
import { EmbedBackfillProcessor } from './embed-backfill.processor';
import { EmbedProcessor } from './embed.processor';
import { ExtractProcessor } from './extract.processor';
import { OcrProcessor } from './ocr.processor';
import { OrphanSweepProcessor } from './orphan-sweep.processor';
import { OutboxRelayProcessor } from './outbox-relay.processor';
import { PlaceholderProcessor } from './placeholder.processor';
import { ProcessorRegistry } from './processor-registry';
import { ProjectDeletionProcessor } from './project-deletion.processor';
import { ReaperProcessor } from './reaper.processor';
import { UsageRollupProcessor } from './usage-rollup.processor';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [PlatformModule, BillingModule, AiModule, ExtractModule, OcrModule, ChunkModule, EmbedModule, RetrievalModule],
  providers: [
    provideRuntimeRole(RuntimeRole.Worker),
    ProcessorRegistry,
    PlaceholderProcessor,
    BillingQueueConsumer,
    BillingSyncProcessor,
    UsageRollupProcessor,
    BillingReconcileProcessor,
    ExtractProcessor,
    OcrProcessor,
    ChunkProcessor,
    EmbedProcessor,
    EmbedBackfillProcessor,
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
