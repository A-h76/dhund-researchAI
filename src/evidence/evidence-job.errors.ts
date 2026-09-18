export class EvidenceJobError extends Error {
  constructor(
    message: string,
    readonly recoverable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'EvidenceJobError';
  }
}

export function isEvidenceJobError(error: unknown): error is EvidenceJobError {
  return error instanceof EvidenceJobError;
}
