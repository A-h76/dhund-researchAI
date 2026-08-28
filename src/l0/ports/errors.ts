export class L0Error extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'L0Error';
  }
}

export class L0ConnectionError extends L0Error {
  constructor(message: string, cause?: unknown) {
    super(message, 'L0_CONNECTION_ERROR', cause);
    this.name = 'L0ConnectionError';
  }
}

export class L0OperationError extends L0Error {
  constructor(message: string, cause?: unknown) {
    super(message, 'L0_OPERATION_ERROR', cause);
    this.name = 'L0OperationError';
  }
}
