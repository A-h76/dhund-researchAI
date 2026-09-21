import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import {
  BootstrapValidationService,
  PROCESSOR_READINESS,
  provideRuntimeRole,
} from '../../platform/config';
import { ChunkModule } from '../../ingestion/chunk.module';
import { ConnectorsModule } from '../../connectors/connectors.module';
import { ExternalRecordsModule } from '../../external-records/external-records.module';
import { IdentityModule } from '../../identity/identity.module';
import { EmbedModule } from '../../ai/embed/embed.module';
import { ExtractModule } from '../../ingestion/extract.module';
import { EvidenceModule } from '../../evidence/evidence.module';
import { OcrModule } from '../../ai/ocr/ocr.module';
import { PlatformModule } from '../../platform/platform.module';
import { RetrievalModule } from '../../retrieval/retrieval.module';
import { RuntimeRole } from '../../platform/runtime/role';
import { ChunkProcessor } from './chunk.processor';
import { ConnectorFetchProcessor } from './connector-fetch.processor';
import { DiscoverySearchProcessor } from './discovery-search.processor';
import { ExternalRecordRefreshProcessor } from './external-record-refresh.processor';
import { IdentityMergeProcessor } from './identity-merge.processor';
import { IdentityResolveProcessor } from './identity-resolve.processor';
import { RefmgrImportProcessor } from './refmgr-import.processor';
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
import { StanceJobConsumer } from './stance-job.consumer';
import { StanceProcessor } from './stance.processor';
import { StanceService } from './stance.service';
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
    ConnectorsModule,
    IdentityModule,
    ExternalRecordsModule,
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
    StanceService,
    StanceJobConsumer,
    StanceProcessor,
    ConnectorFetchProcessor,
    DiscoverySearchProcessor,
    IdentityResolveProcessor,
    IdentityMergeProcessor,
    ExternalRecordRefreshProcessor,
    RefmgrImportProcessor,
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
