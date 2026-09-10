import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AnnSearch } from './ann-search';
import { LexicalSearch } from './lexical-search';
import { RetrievalMetrics } from './retrieval.metrics';
import { TrigramIdentityLookup } from './trigram-identity';

@Module({
  imports: [PlatformModule],
  providers: [AnnSearch, LexicalSearch, TrigramIdentityLookup, RetrievalMetrics],
  exports: [AnnSearch, LexicalSearch, TrigramIdentityLookup, RetrievalMetrics],
})
export class RetrievalModule {}
