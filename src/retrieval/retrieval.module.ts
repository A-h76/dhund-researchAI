import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AnnSearch } from './ann-search';

@Module({
  imports: [PlatformModule],
  providers: [AnnSearch],
  exports: [AnnSearch],
})
export class RetrievalModule {}
