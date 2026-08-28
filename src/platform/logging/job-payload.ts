export interface BaseJobPayload {
  readonly correlationId: string;
  readonly orgId: string;
  readonly projectId?: string;
}

export class InvalidJobPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobPayloadError';
  }
}

export function assertValidJobPayload(
  payload: unknown,
): asserts payload is BaseJobPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InvalidJobPayloadError('Job payload must be an object');
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.correlationId !== 'string' || record.correlationId.length === 0) {
    throw new InvalidJobPayloadError('Job payload is missing correlationId');
  }

  if (typeof record.orgId !== 'string' || record.orgId.length === 0) {
    throw new InvalidJobPayloadError('Job payload is missing orgId');
  }

  if (
    record.projectId !== undefined &&
    (typeof record.projectId !== 'string' || record.projectId.length === 0)
  ) {
    throw new InvalidJobPayloadError('Job payload projectId must be a non-empty string');
  }
}

export function isBaseJobPayload(payload: unknown): payload is BaseJobPayload {
  try {
    assertValidJobPayload(payload);
    return true;
  } catch {
    return false;
  }
}
