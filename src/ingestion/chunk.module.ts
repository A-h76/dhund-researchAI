import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { ChunkMetrics } from './chunk.metrics';
import { ChunkService } from './chunk.service';

@Module({
  imports: [PlatformModule],
  providers: [ChunkService, ChunkMetrics],
  exports: [ChunkService, ChunkMetrics],
})
export class ChunkModule {}
