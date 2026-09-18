import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { ClaimsGraphService } from './claims-graph.service';
import { ClaimsMetrics } from './claims.metrics';
import { CitationsService } from './citations.service';
import { CitationMetrics } from './citations.metrics';
import { EvidenceMetrics } from './evidence.metrics';
import { EvidenceRepository } from './evidence.repository';
import { ClaimsRepository } from './scoped-repos';
import { SentenceProjectionService } from './sentence-projection.service';
import { SourcesRepository } from './sources.repository';

@Module({
  imports: [PlatformModule],
  providers: [
    EvidenceMetrics,
    SourcesRepository,
    EvidenceRepository,
    ClaimsRepository,
    ClaimsMetrics,
    CitationMetrics,
    ClaimsGraphService,
    CitationsService,
    SentenceProjectionService,
  ],
  exports: [
    EvidenceMetrics,
    SourcesRepository,
    EvidenceRepository,
    ClaimsRepository,
    ClaimsMetrics,
    CitationMetrics,
    ClaimsGraphService,
    CitationsService,
    SentenceProjectionService,
  ],
})
export class EvidenceModule {}
