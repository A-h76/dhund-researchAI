import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module';
import { AiModule } from '../ai.module';
import { EmbedBackfillAdminService } from './embed-backfill.admin';
import { EmbedBackfillService } from './embed-backfill.service';
import { EmbedMetrics } from './embed.metrics';
import { EmbedService } from './embed.service';

/**
 * Worker-only. EmbedBackfillAdminService is deliberately not exported to any
 * HTTP module — the backfill queue has no /v1 producer (GAP-ADMIN-JOB-01).
 */
@Module({
  imports: [PlatformModule, AiModule],
  providers: [EmbedService, EmbedBackfillService, EmbedBackfillAdminService, EmbedMetrics],
  exports: [EmbedService, EmbedBackfillService, EmbedBackfillAdminService, EmbedMetrics],
})
export class EmbedModule {}
