import { Injectable, type NestMiddleware } from '@nestjs/common';
import { CORRELATION_ID_HEADER } from '../errors/error-envelope';
import { runWithCorrelationId } from './correlation-context';
import { readCorrelationHeader, resolveCorrelationId } from './correlation-id';

interface HttpRequestLike {
  readonly headers: Record<string, unknown>;
}

interface HttpResponseLike {
  setHeader(name: string, value: string): void;
}

type NextFunction = () => void;

export function correlationExpressMiddleware(
  req: HttpRequestLike,
  res: HttpResponseLike,
  next: NextFunction,
): void {
  const correlationId = resolveCorrelationId(readCorrelationHeader(req.headers));
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  runWithCorrelationId(correlationId, () => next());
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: HttpRequestLike, res: HttpResponseLike, next: NextFunction): void {
    correlationExpressMiddleware(req, res, next);
  }
}
