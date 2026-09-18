import { Module } from '@nestjs/common';
import { EvidenceModule } from '../evidence/evidence.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { PlatformModule } from '../platform/platform.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ResearchRunCoordinationService } from './research-run-coordination.service';
import { ResearchRunCoordinatorService } from './research-run-coordinator.service';
import { ResearchRunMetrics } from './research-run.metrics';
import { ResearchRunPlannerService } from './research-run-planner.service';
import { ResearchRunTransitionService } from './research-run-transition.service';
import { ORCHESTRATION_REPOS } from './scoped-repos';

const RESEARCH_RUN_PROVIDERS = [
  ResearchRunMetrics,
  ResearchRunCoordinationService,
  ResearchRunTransitionService,
  ResearchRunPlannerService,
  ResearchRunCoordinatorService,
] as const;

@Module({
  imports: [PlatformModule, IngestionModule, RetrievalModule, EvidenceModule],
  providers: [...ORCHESTRATION_REPOS, ...RESEARCH_RUN_PROVIDERS],
  exports: [
    IngestionModule,
    RetrievalModule,
    EvidenceModule,
    ...ORCHESTRATION_REPOS,
    ...RESEARCH_RUN_PROVIDERS,
  ],
})
export class OrchestrationModule {}
