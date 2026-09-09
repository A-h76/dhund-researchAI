import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { ClaimsRepository, EvidenceRepository } from './scoped-repos';

@Module({
  imports: [PlatformModule],
  providers: [EvidenceRepository, ClaimsRepository],
  exports: [EvidenceRepository, ClaimsRepository],
})
export class EvidenceModule {}
