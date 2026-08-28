import {
  MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AiModule } from '../../ai/ai.module';
import {
  PROCESSOR_READINESS,
  provideRuntimeRole,
} from '../../platform/config';
import { GlobalExceptionFilter } from '../../platform/errors/global-exception.filter';
import {
  CorrelationMiddleware,
  HttpLoggingInterceptor,
} from '../../platform/logging';
import { RuntimeRole } from '../../platform/runtime/role';
import { PlatformModule } from '../../platform/platform.module';
import { ApiEventsGateway } from './api-events.gateway';
import { ApiRootController } from './api-root.controller';
import { CapabilityProbeController } from './capability-probe.controller';
import { HealthController } from './health.controller';
import { NoopProcessorReadiness } from './noop-processor-readiness';

@Module({
  imports: [PlatformModule, AiModule],
  controllers: [ApiRootController, HealthController, CapabilityProbeController],
  providers: [
    ApiEventsGateway,
    provideRuntimeRole(RuntimeRole.Api),
    { provide: PROCESSOR_READINESS, useClass: NoopProcessorReadiness },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
  ],
})
export class ApiAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
