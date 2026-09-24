import {
  Catch,
  HttpException,
  Injectable,
  Optional,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  getCorrelationId,
  PlatformLogger,
} from '../logging';
import {
  clientMessageFor,
  ErrorCode,
  httpStatusFor,
  isPasswordRejectionDetails,
  isServerErrorStatus,
} from './error-codes';
import { DomainError } from './domain-error';
import type { ErrorEnvelope } from './error-envelope';
import { CORRELATION_ID_HEADER } from './error-envelope';
import { readCorrelationHeader, resolveCorrelationId } from './correlation-id';
import {
  containsForbiddenLeak,
  containsSensitiveKey,
  sanitizeForLog,
} from './leakage-guard';
import { MetricsSurface } from '../observability/metrics-surface';

interface HttpRequestLike {
  headers?: Record<string, unknown>;
  url?: string;
}

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  setHeader?(name: string, value: string): HttpResponseLike;
  json(body: unknown): unknown;
}

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PlatformLogger,
    @Optional() private readonly metrics?: MetricsSurface,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<HttpRequestLike>();
    const response = ctx.getResponse<HttpResponseLike>();
    const correlationId =
      getCorrelationId() ??
      resolveCorrelationId(readCorrelationHeader(request.headers));
    const mapped = mapException(exception);
    if (
      this.metrics !== undefined &&
      (mapped.code === ErrorCode.ValidationError || mapped.code === ErrorCode.MalformedRequest)
    ) {
      this.metrics.recordValidationFailure(metricRoute(request.url));
    }
    const envelope = toEnvelope(mapped, correlationId);

    this.logger.error({
      module: mapped.module,
      message: 'http.error',
      code: mapped.code,
      status: mapped.status,
      detail: mapped.serverDetail,
    });

    if (response.setHeader !== undefined) {
      response.setHeader(CORRELATION_ID_HEADER, correlationId);
    }

    if (
      mapped.code === ErrorCode.RateLimited &&
      isRetryAfterSeconds(mapped.details)
    ) {
      response.setHeader?.(
        'retry-after',
        String(mapped.details.retryAfterSeconds),
      );
    }

    response.status(mapped.status).json(envelope);
  }
}

interface MappedError {
  code: ErrorCode;
  status: number;
  details: unknown | undefined;
  userMessage: string;
  module: string;
  serverDetail: unknown;
}

function metricRoute(path: string | undefined): string {
  const bare = (path ?? '/').split('?')[0] ?? '/';
  const collapsed = bare.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id',
  );
  if (containsForbiddenLeak(collapsed) || collapsed.length > 120) {
    return 'redacted';
  }
  return collapsed;
}

function mapException(exception: unknown): MappedError {
  if (exception instanceof DomainError) {
    const status = httpStatusFor(exception.code);
    return {
      code: exception.code,
      status,
      details: clientDetails(exception),
      userMessage: exception.userMessage,
      module: exception.module,
      serverDetail: serverDetailFor(exception),
    };
  }

  if (exception instanceof HttpException) {
    const code = codeForHttpStatus(exception.getStatus());
    const status = httpStatusFor(code);
    return {
      code,
      status,
      details: undefined,
      userMessage: clientMessageFor(code),
      module: 'http',
      serverDetail: sanitizeForLog({
        kind: 'http_exception',
        status: exception.getStatus(),
      }),
    };
  }

  if (isDatabaseError(exception)) {
    return {
      code: ErrorCode.InternalError,
      status: httpStatusFor(ErrorCode.InternalError),
      details: undefined,
      userMessage: clientMessageFor(ErrorCode.InternalError),
      module: 'database',
      serverDetail: sanitizeForLog({ kind: 'database' }),
    };
  }

  return {
    code: ErrorCode.InternalError,
    status: httpStatusFor(ErrorCode.InternalError),
    details: undefined,
    userMessage: clientMessageFor(ErrorCode.InternalError),
    module: 'api',
    serverDetail: sanitizeForLog({
      kind: 'unhandled',
      name: exception instanceof Error ? exception.name : 'unknown',
    }),
  };
}

function clientDetails(error: DomainError): unknown | undefined {
  if (isServerErrorStatus(httpStatusFor(error.code))) {
    return undefined;
  }

  if (error.code === ErrorCode.NotFound) {
    return undefined;
  }

  if (
    error.code === ErrorCode.InvalidCredentials ||
    error.code === ErrorCode.TokenInvalid ||
    error.code === ErrorCode.MfaInvalid ||
    error.code === ErrorCode.MfaRecoveryInvalid
  ) {
    return undefined;
  }

  if (error.details === undefined) {
    return undefined;
  }

  if (containsSensitiveKey(error.details) || containsForbiddenLeak(error.details)) {
    return undefined;
  }

  if (
    error.code === ErrorCode.ValidationError &&
    isPasswordRejectionDetails(error.details)
  ) {
    return error.details;
  }

  return error.details;
}

function serverDetailFor(error: DomainError): unknown {
  return sanitizeForLog(error.serverDetail ?? { kind: 'domain', code: error.code });
}

function toEnvelope(mapped: MappedError, correlationId: string): ErrorEnvelope {
  if (isServerErrorStatus(mapped.status)) {
    return {
      code: mapped.code,
      correlationId,
    };
  }

  const envelope: ErrorEnvelope = {
    code: mapped.code,
    message: mapped.userMessage,
    correlationId,
  };

  if (mapped.details !== undefined) {
    envelope.details = mapped.details;
  }

  if (containsForbiddenLeak(envelope) || containsSensitiveKey(envelope)) {
    return {
      code: mapped.code,
      message: clientMessageFor(mapped.code),
      correlationId,
    };
  }

  return envelope;
}

function codeForHttpStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.MalformedRequest;
    case 401:
      return ErrorCode.Unauthenticated;
    case 403:
      return ErrorCode.Forbidden;
    case 404:
      return ErrorCode.NotFound;
    case 409:
      return ErrorCode.AlreadyExists;
    case 413:
      return ErrorCode.FileTooLarge;
    case 422:
      return ErrorCode.ValidationError;
    case 429:
      return ErrorCode.RateLimited;
    case 502:
      return ErrorCode.UpstreamUnavailable;
    case 503:
      return ErrorCode.ServiceUnavailable;
    case 504:
      return ErrorCode.UpstreamTimeout;
    default:
      if (status >= 500) {
        return ErrorCode.InternalError;
      }
      if (status >= 400) {
        return ErrorCode.MalformedRequest;
      }
      return ErrorCode.InternalError;
  }
}

function isDatabaseError(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) {
    return false;
  }

  const record = exception as { clientVersion?: unknown; code?: unknown };
  if (typeof record.clientVersion === 'string') {
    return true;
  }

  return typeof record.code === 'string' && /^P[1-4]\d{3}$/.test(record.code);
}

function isRetryAfterSeconds(
  details: unknown,
): details is { retryAfterSeconds: number } {
  if (typeof details !== 'object' || details === null) {
    return false;
  }

  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

