import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AiModule } from '../../ai/ai.module';
import { GlobalExceptionFilter } from '../../platform/errors/global-exception.filter';
import { PlatformModule } from '../../platform/platform.module';
import { ApiEventsGateway } from './api-events.gateway';
import { ApiRootController } from './api-root.controller';

@Module({
  imports: [PlatformModule, AiModule],
  controllers: [ApiRootController],
  providers: [
    ApiEventsGateway,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class ApiAppModule {}
