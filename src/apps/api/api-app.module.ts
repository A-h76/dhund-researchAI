import {
  MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AiModule } from '../../ai/ai.module';
import { GlobalExceptionFilter } from '../../platform/errors/global-exception.filter';
import {
  CorrelationMiddleware,
  HttpLoggingInterceptor,
} from '../../platform/logging';
import { PlatformModule } from '../../platform/platform.module';
import { ApiEventsGateway } from './api-events.gateway';
import { ApiRootController } from './api-root.controller';

@Module({
  imports: [PlatformModule, AiModule],
  controllers: [ApiRootController],
  providers: [
    ApiEventsGateway,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
  ],
})
export class ApiAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
