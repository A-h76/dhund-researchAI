export class GatewayExecutionFailedError extends Error {
  readonly aiExecutionId: string;
  readonly attemptErrors: readonly string[];

  constructor(aiExecutionId: string, attemptErrors: readonly string[]) {
    const summary =
      attemptErrors.length > 0 ? attemptErrors.join('; ') : 'AI execution failed';
    super(summary);
    this.name = 'GatewayExecutionFailedError';
    this.aiExecutionId = aiExecutionId;
    this.attemptErrors = attemptErrors;
  }
}
