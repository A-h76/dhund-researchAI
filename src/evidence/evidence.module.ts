import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module';
import { L0Module } from '../l0/l0.module';
import { PlatformModule } from '../platform/platform.module';
import { ProjectsModule } from '../projects/projects.module';
import { ClaimsGraphService } from './claims-graph.service';
import { ClaimsMetrics } from './claims.metrics';
import { EvidenceMetrics } from './evidence.metrics';

@Module({
  imports: [ProjectsModule, PlatformModule, L0Module, IngestionModule],
  providers: [EvidenceMetrics, ClaimsMetrics, ClaimsGraphService],
  exports: [ProjectsModule, L0Module, IngestionModule, EvidenceMetrics, ClaimsMetrics, ClaimsGraphService],
})
export class EvidenceModule {}
