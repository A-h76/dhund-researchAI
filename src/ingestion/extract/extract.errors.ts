export class ExtractError extends Error {
  constructor(
    message: string,
    readonly recoverable: boolean,
    readonly causeCode:
      | 'missing_version'
      | 'parse_error'
      | 'storage_error'
      | 'persist_error'
      | 'unknown' = 'unknown',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ExtractError';
  }
}

export function isExtractError(error: unknown): error is ExtractError {
  return error instanceof ExtractError;
}
