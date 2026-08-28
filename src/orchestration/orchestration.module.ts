import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { EvidenceModule } from '../evidence/evidence.module';

@Module({
  imports: [IngestionModule, RetrievalModule, EvidenceModule],
  exports: [IngestionModule, RetrievalModule, EvidenceModule],
})
export class OrchestrationModule {}
