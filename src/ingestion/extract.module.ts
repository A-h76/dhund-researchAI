import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { ExtractMetrics } from './extract.metrics';
import { ExtractService } from './extract.service';

@Module({
  imports: [PlatformModule],
  providers: [ExtractService, ExtractMetrics],
  exports: [ExtractService, ExtractMetrics],
})
export class ExtractModule {}
