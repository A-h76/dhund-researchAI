import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AnnSearch } from './ann-search';
import { LexicalSearch } from './lexical-search';
import { RetrievalMetrics } from './retrieval.metrics';
import { RETRIEVAL_SERVICE } from './retrieval.port';
import { RetrievalService } from './retrieval.service';
import { MergeApprovalService } from './merge-approval.service';
import { TrigramIdentityLookup } from './trigram-identity';

@Module({
  imports: [PlatformModule],
  providers: [
    AnnSearch,
    LexicalSearch,
    TrigramIdentityLookup,
    MergeApprovalService,
    RetrievalMetrics,
    RetrievalService,
    { provide: RETRIEVAL_SERVICE, useExisting: RetrievalService },
  ],
  exports: [
    AnnSearch,
    LexicalSearch,
    TrigramIdentityLookup,
    MergeApprovalService,
    RetrievalMetrics,
    RetrievalService,
    RETRIEVAL_SERVICE,
  ],
})
export class RetrievalModule {}
