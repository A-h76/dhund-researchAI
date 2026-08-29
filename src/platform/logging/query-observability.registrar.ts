import { Injectable, OnModuleInit } from '@nestjs/common';
import { registerQueryObservability } from '../../l0/observability-bridge';
import { getCorrelationId } from './correlation-context';
import { PlatformLogger } from './platform-logger.service';

@Injectable()
export class QueryObservabilityRegistrar implements OnModuleInit {
  constructor(private readonly logger: PlatformLogger) {}

  onModuleInit(): void {
    registerQueryObservability({
      readCorrelationId: getCorrelationId,
      onSlowQuery: (event) => {
        this.logger.warn({
          module: 'database',
          message: 'db.slow_query',
          durationMs: event.durationMs,
          operation: event.operation,
          ...(event.model !== undefined ? { model: event.model } : {}),
          ...(event.correlationId !== undefined
            ? { correlationId: event.correlationId }
            : {}),
        });
      },
    });
  }
}
