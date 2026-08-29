import { Global, Module } from '@nestjs/common';
import { LoggerModule as NestPinoLoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { L0Module } from '../../l0/l0.module';
import { ConfigModule } from '../config/config.module';
import { getAppConfig } from '../config/config.runtime';
import { createPinoOptions } from './pino.config';
import { JobEnqueueService } from './job-enqueue.service';
import { PlatformLogger } from './platform-logger.service';
import { QueryObservabilityRegistrar } from './query-observability.registrar';

@Global()
@Module({
  imports: [
    ConfigModule,
    L0Module,
    NestPinoLoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          logger: pino(createPinoOptions(getAppConfig().logLevel)),
          autoLogging: false,
        },
      }),
    }),
  ],
  providers: [PlatformLogger, JobEnqueueService, QueryObservabilityRegistrar],
  exports: [NestPinoLoggerModule, PlatformLogger, JobEnqueueService],
})
export class LoggerModule {}
