const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'authorization',
  'prompt',
  'promptText',
  'documentText',
  'evidenceText',
  'body',
  'content',
  'text',
]);

export function sanitizeForDlq(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForDlq(item));
  }

  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(record)) {
    if (SENSITIVE_FIELD_NAMES.has(key)) {
      continue;
    }

    if (typeof nested === 'string' && nested.length > 512) {
      sanitized[key] = '[Redacted:long-string]';
      continue;
    }

    sanitized[key] = sanitizeForDlq(nested);
  }

  return sanitized;
}

export function buildDlqEntry(input: {
  originalJobId: string;
  queue: import('./queue-names').QueueName;
  orgId: string;
  projectId?: string;
  correlationId: string;
  naturalKey: Record<string, unknown>;
  errorMessage: string;
  failedAt: string;
  attemptCount: number;
}): Record<string, unknown> {
  return sanitizeForDlq({
    originalJobId: input.originalJobId,
    queue: input.queue,
    orgId: input.orgId,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    correlationId: input.correlationId,
    naturalKey: input.naturalKey,
    errorMessage: input.errorMessage,
    failedAt: input.failedAt,
    attemptCount: input.attemptCount,
  }) as Record<string, unknown>;
}
