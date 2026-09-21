export class ConnectorJobError extends Error {
  constructor(
    message: string,
    readonly recoverable: boolean,
  ) {
    super(message);
    this.name = 'ConnectorJobError';
  }
}

export class ConnectorRateLimitedJobError extends ConnectorJobError {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message, true);
    this.name = 'ConnectorRateLimitedJobError';
  }
}

export class ConnectorCircuitOpenError extends ConnectorJobError {
  constructor(connectorId: string) {
    super(`Connector circuit open: ${connectorId}`, true);
    this.name = 'ConnectorCircuitOpenError';
  }
}

export function isConnectorJobError(error: unknown): error is ConnectorJobError {
  return error instanceof ConnectorJobError;
}
