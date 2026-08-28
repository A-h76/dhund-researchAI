import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs';
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
  constructor(private readonly logger: PlatformLogger) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<HttpResponseLike>();
        this.logger.info({
          module: 'http',
          message: 'request.completed',
          method: request.method,
          path: request.url,
          status: response.statusCode,
          durationMs: Date.now() - startedAt,
        });
      }),
    );
  }
}
