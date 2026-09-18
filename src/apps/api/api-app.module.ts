import {
  MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AiModule } from '../../ai/ai.module';
import {
  PROCESSOR_READINESS,
  BootstrapValidationService,
  provideRuntimeRole,
} from '../../platform/config';
import { GlobalExceptionFilter } from '../../platform/errors/global-exception.filter';
import {
  CorrelationMiddleware,
  HttpLoggingInterceptor,
} from '../../platform/logging';
import { CsrfMiddleware } from '../../platform/http';
import { RuntimeRole } from '../../platform/runtime/role';
import { PlatformModule } from '../../platform/platform.module';
import { IamModule } from '../../iam/iam.module';
import { IngestionModule } from '../../ingestion/ingestion.module';
import { ProjectsModule } from '../../projects/projects.module';
import { RetrievalModule } from '../../retrieval/retrieval.module';
import { RetrievalApiModule } from '../../retrieval/retrieval-api.module';
import { OrchestrationApiModule } from '../../orchestration/orchestration-api.module';
import { EvidenceModule } from '../../evidence/evidence.module';
import { ApiRealtimeModule } from './api-realtime.module';
import { ApiRootController } from './api-root.controller';
import { CapabilityProbeController } from './capability-probe.controller';
import { HealthController } from './health.controller';
import { NoopProcessorReadiness } from './noop-processor-readiness';
import { WritingSentenceBindingsController } from './writing-sentence-bindings.controller';

@Module({
  imports: [
    PlatformModule,
    AiModule,
    IamModule,
    ProjectsModule,
    IngestionModule,
    RetrievalModule,
    RetrievalApiModule,
    ApiRealtimeModule,
    OrchestrationApiModule,
    EvidenceModule,
  ],
  controllers: [
    ApiRootController,
    HealthController,
    CapabilityProbeController,
    WritingSentenceBindingsController,
  ],
  providers: [
    provideRuntimeRole(RuntimeRole.Api),
    { provide: PROCESSOR_READINESS, useClass: NoopProcessorReadiness },
    BootstrapValidationService,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
  ],
})
export class ApiAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, CsrfMiddleware).forRoutes('*');
  }
}
