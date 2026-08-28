const FORBIDDEN_LEAK_PATTERNS: readonly RegExp[] = [
  /\bat\s+\S+\s+\([^)]+:\d+:\d+\)/,
  /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b.*\b(?:FROM|INTO|SET)\b/i,
  /\bconstraint\b/i,
  /\bPrismaClient/i,
  /\bP[1-4]\d{3}\b/,
  /\b(?:openai|anthropic|voyage(?:-\d+)?|gpt-4o?|gpt-3\.5|text-embedding)\b/i,
  /\b(?:amazonaws|\.s3[.-]|minio)\b/i,
  /\b169\.254\.169\.254\b/,
  /\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\bsk-[A-Za-z0-9]{8,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /postgres(?:ql)?:\/\//i,
  /redis:\/\//i,
  /\bpublic\.\w+\b/i,
];

const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'authorization',
  'stack',
  'prompt',
  'prompttext',
  'documenttext',
  'evidencetext',
]);

export function containsForbiddenLeak(value: unknown): boolean {
  return scan(value, FORBIDDEN_LEAK_PATTERNS);
}

export function containsSensitiveKey(value: unknown): boolean {
  return hasSensitiveKey(value);
}

export function sanitizeForLog(value: unknown): unknown {
  const redacted = redactSensitive(value);
  if (containsForbiddenLeak(redacted)) {
    return { redacted: true };
  }
  return redacted;
}

function hasSensitiveKey(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasSensitiveKey(entry));
  }

  if (typeof value === 'object' && !(value instanceof Error)) {
    return Object.entries(value).some(([key, entry]) => {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        return true;
      }
      return hasSensitiveKey(entry);
    });
  }

  if (value instanceof Error) {
    return hasSensitiveKey(value.cause);
  }

  return false;
}

function redactSensitive(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry));
  }

  if (typeof value === 'object' && !(value instanceof Error)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        continue;
      }
      result[key] = redactSensitive(entry);
    }
    return result;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
    };
  }

  return value;
}

function scan(value: unknown, patterns: readonly RegExp[]): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return patterns.some((pattern) => pattern.test(value));
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return false;
  }

  if (value instanceof Error) {
    return (
      scan(value.name, patterns) ||
      scan(value.message, patterns) ||
      scan(value.stack, patterns) ||
      scan(value.cause, patterns)
    );
  }

  if (Array.isArray(value)) {
    return value.some((entry) => scan(entry, patterns));
  }

  if (typeof value === 'object') {
    return Object.values(value).some((entry) => scan(entry, patterns));
  }

  return false;
}
