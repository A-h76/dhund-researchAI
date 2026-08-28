import { Module } from '@nestjs/common';
import { OrchestrationModule } from '../orchestration/orchestration.module';

@Module({
  imports: [OrchestrationModule],
  exports: [OrchestrationModule],
})
export class AiModule {}
