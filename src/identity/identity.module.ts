import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { IdentityMetrics } from './identity.metrics';
import { IdentityMergeService } from './identity-merge.service';
import { IdentityResolveService } from './identity-resolve.service';
import { MergeReviewService } from './merge-review.service';

@Module({
  imports: [PlatformModule],
  providers: [
    IdentityMetrics,
    IdentityResolveService,
    IdentityMergeService,
    MergeReviewService,
  ],
  exports: [
    IdentityMetrics,
    IdentityResolveService,
    IdentityMergeService,
    MergeReviewService,
  ],
})
export class IdentityModule {}
