import {
  Injectable,
  Optional,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs';
import { routeClassForPath } from '../observability/metric-labels';
import { MetricsSurface } from '../observability/metrics-surface';
import { PlatformLogger } from './platform-logger.service';

interface HttpRequestLike {
  readonly method?: string;
  readonly url?: string;
}

interface HttpResponseLike {
  readonly statusCode: number;
}

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: PlatformLogger,
    @Optional() private readonly metrics?: MetricsSurface,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.complete(request, context, startedAt, false);
        },
        error: (err: unknown) => {
          this.complete(request, context, startedAt, true);
          throw err;
        },
      }),
    );
  }

  private complete(
    request: HttpRequestLike,
    context: ExecutionContext,
    startedAt: number,
    error: boolean,
  ): void {
    const response = context.switchToHttp().getResponse<HttpResponseLike>();
    const durationMs = Date.now() - startedAt;
    const status = error ? 500 : response.statusCode;
    this.metrics?.recordApi({
      routeClass: routeClassForPath(request.url),
      latencyMs: durationMs,
      error: error || status >= 500,
    });
    this.logger.info({
      module: 'http',
      message: 'request.completed',
      method: request.method,
      path: request.url,
      status,
      durationMs,
    });
  }
}
