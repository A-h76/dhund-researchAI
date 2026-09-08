export type AdapterErrorKind =
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'auth'
  | 'circuit_open'
  | 'terminal';

export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(
    kind: AdapterErrorKind,
    message: string,
    options: { retryable?: boolean; httpStatus?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AdapterError';
    this.kind = kind;
    this.retryable = options.retryable ?? isRetryableKind(kind);
    if (options.httpStatus !== undefined) {
      this.httpStatus = options.httpStatus;
    }
  }
}

function isRetryableKind(kind: AdapterErrorKind): boolean {
  switch (kind) {
    case 'rate_limited':
    case 'unavailable':
    case 'timeout':
      return true;
    case 'auth':
    case 'circuit_open':
    case 'terminal':
      return false;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function isAdapterError(error: unknown): error is AdapterError {
  return error instanceof AdapterError;
}

export function classifyProviderError(error: unknown): AdapterError {
  if (error instanceof AdapterError) {
    return error;
  }

  const status = readHttpStatus(error);
  if (status === 429) {
    return new AdapterError('rate_limited', 'Provider rate limited', {
      httpStatus: 429,
      cause: error,
    });
  }
  if (status === 401 || status === 403) {
    return new AdapterError('auth', 'Provider authentication failed', {
      httpStatus: status,
      cause: error,
    });
  }
  if (status !== undefined && status >= 500) {
    return new AdapterError('unavailable', 'Provider unavailable', {
      httpStatus: status,
      cause: error,
    });
  }
  if (status !== undefined && status >= 400) {
    return new AdapterError('terminal', 'Provider rejected the request', {
      httpStatus: status,
      cause: error,
    });
  }

  const message = error instanceof Error ? error.message : 'Provider invocation failed';
  if (/timeout|etimedout|econnreset|econnrefused|network/i.test(message)) {
    return new AdapterError('timeout', message, { cause: error });
  }

  return new AdapterError('unavailable', message, { cause: error });
}

function readHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const record = error as { status?: unknown; statusCode?: unknown };
  if (typeof record.status === 'number') {
    return record.status;
  }
  if (typeof record.statusCode === 'number') {
    return record.statusCode;
  }

  return undefined;
}
