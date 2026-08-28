import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { PlatformModule } from '../../platform/platform.module';
import { ApiEventsGateway } from './api-events.gateway';
import { ApiRootController } from './api-root.controller';

@Module({
  imports: [PlatformModule, AiModule],
  controllers: [ApiRootController],
  providers: [ApiEventsGateway],
})
export class ApiAppModule {}
