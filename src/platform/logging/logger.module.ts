import { Global, Module } from '@nestjs/common';
import { LoggerModule as NestPinoLoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { L0Module } from '../../l0/l0.module';
import { createPinoOptions } from './pino.config';
import { JobEnqueueService } from './job-enqueue.service';
import { PlatformLogger } from './platform-logger.service';

@Global()
@Module({
  imports: [
    L0Module,
    NestPinoLoggerModule.forRoot({
      pinoHttp: {
        logger: pino(createPinoOptions()),
        autoLogging: false,
      },
    }),
  ],
  providers: [PlatformLogger, JobEnqueueService],
  exports: [NestPinoLoggerModule, PlatformLogger, JobEnqueueService],
})
export class LoggerModule {}
