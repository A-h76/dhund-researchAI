import { Module } from '@nestjs/common';
import { EvidenceModule } from '../evidence/evidence.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { PlatformModule } from '../platform/platform.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ORCHESTRATION_REPOS } from './scoped-repos';

@Module({
  imports: [PlatformModule, IngestionModule, RetrievalModule, EvidenceModule],
  providers: [...ORCHESTRATION_REPOS],
  exports: [
    IngestionModule,
    RetrievalModule,
    EvidenceModule,
    ...ORCHESTRATION_REPOS,
  ],
})
export class OrchestrationModule {}
