import { Module } from '@nestjs/common';
import { OrchestrationModule } from '../../orchestration/orchestration.module';
import { PlatformModule } from '../../platform/platform.module';
import { WorkerBootstrapService } from './worker-bootstrap.service';

@Module({
  imports: [PlatformModule, OrchestrationModule],
  providers: [WorkerBootstrapService],
})
export class WorkerAppModule {}
