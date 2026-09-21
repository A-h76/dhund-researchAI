import { Module } from '@nestjs/common';
import { EvidenceModule } from '../evidence/evidence.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { PlatformModule } from '../platform/platform.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ExtractionCellService } from './extraction-cell.service';
import { ExtractionMatrixMetrics } from './extraction-matrix.metrics';
import { ExtractionMatrixService } from './extraction-matrix.service';
import { ResearchRunCoordinationService } from './research-run-coordination.service';
import { ResearchRunCoordinatorService } from './research-run-coordinator.service';
import { ResearchArtifactGenerateService } from './research-artifact-generate.service';
import { ResearchRunMetrics } from './research-run.metrics';
import { ResearchRunPlannerService } from './research-run-planner.service';
import { ResearchRunTransitionService } from './research-run-transition.service';
import { ScreeningMetrics } from './screening.metrics';
import { ScreeningStubService } from './screening-stub.service';
import { ORCHESTRATION_REPOS } from './scoped-repos';

const RESEARCH_RUN_PROVIDERS = [
  ResearchRunMetrics,
  ResearchRunCoordinationService,
  ResearchRunTransitionService,
  ResearchRunPlannerService,
  ResearchRunCoordinatorService,
  ResearchArtifactGenerateService,
  ExtractionMatrixMetrics,
  ExtractionMatrixService,
  ExtractionCellService,
] as const;

@Module({
  imports: [PlatformModule, IngestionModule, RetrievalModule, EvidenceModule],
  providers: [
    ...ORCHESTRATION_REPOS,
    ...RESEARCH_RUN_PROVIDERS,
    ScreeningMetrics,
    ScreeningStubService,
  ],
  exports: [
    IngestionModule,
    RetrievalModule,
    EvidenceModule,
    ...ORCHESTRATION_REPOS,
    ...RESEARCH_RUN_PROVIDERS,
    ScreeningMetrics,
    ScreeningStubService,
  ],
})
export class OrchestrationModule {}
