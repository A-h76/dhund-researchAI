import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { PlatformModule } from '../platform/platform.module';
import { RetrievalSearchController } from './retrieval-search.controller';
import { RetrievalSearchService } from './retrieval-search.service';
import { RetrievalModule } from './retrieval.module';

@Module({
  imports: [PlatformModule, IamModule, RetrievalModule],
  controllers: [RetrievalSearchController],
  providers: [RetrievalSearchService],
})
export class RetrievalApiModule {}
