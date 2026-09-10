import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { EvidenceMetrics } from './evidence.metrics';
import { EvidenceRepository } from './evidence.repository';
import { ClaimsRepository } from './scoped-repos';
import { SourcesRepository } from './sources.repository';

@Module({
  imports: [PlatformModule],
  providers: [
    EvidenceMetrics,
    SourcesRepository,
    EvidenceRepository,
    ClaimsRepository,
  ],
  exports: [
    EvidenceMetrics,
    SourcesRepository,
    EvidenceRepository,
    ClaimsRepository,
  ],
})
export class EvidenceModule {}
