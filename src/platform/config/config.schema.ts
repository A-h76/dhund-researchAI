import type { SecretsService } from '../../l0/ports/secrets.port';
import { ConfigValidationError } from './config-validation.error';

const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

export function parseRequiredSecret(
  secrets: SecretsService,
  name: string,
): string {
  const value = secrets.getSecret(name);
  if (value === undefined) {
    throw new ConfigValidationError(`Missing required configuration: ${name}`);
  }

  return value;
}

export function parsePort(value: string | undefined, required: boolean): number {
  if (value === undefined) {
    if (required) {
      return 3000;
    }
    return 3000;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ConfigValidationError('PORT must be an integer between 1 and 65535');
  }

  return parsed;
}

export function parseLogLevel(value: string | undefined): string {
  const level = (value ?? 'info').toLowerCase();
  if (!LOG_LEVELS.has(level)) {
    throw new ConfigValidationError(
      'LOG_LEVEL must be one of trace, debug, info, warn, error, fatal',
    );
  }

  return level;
}

export function parseEmbeddingDimension(value: string | undefined): number {
  const raw = value ?? '1536';
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigValidationError('EMBEDDING_DIMENSION must be a positive integer');
  }

  return parsed;
}

/** Default Prisma connection pool size when DATABASE_POOL_SIZE is unset. */
export const DEFAULT_DATABASE_POOL_SIZE = 10;
export const MIN_DATABASE_POOL_SIZE = 1;
export const MAX_DATABASE_POOL_SIZE = 100;

export function parseDatabasePoolSize(value: string | undefined): number {
  const raw = value ?? String(DEFAULT_DATABASE_POOL_SIZE);
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_DATABASE_POOL_SIZE ||
    parsed > MAX_DATABASE_POOL_SIZE
  ) {
    throw new ConfigValidationError(
      `DATABASE_POOL_SIZE must be an integer between ${MIN_DATABASE_POOL_SIZE} and ${MAX_DATABASE_POOL_SIZE}`,
    );
  }

  return parsed;
}

export function parseFeatureFlags(
  secrets: SecretsService,
): Readonly<Record<string, boolean>> {
  const flags: Record<string, boolean> = {};

  for (const key of secrets.listSecretKeys()) {
    if (!key.startsWith('FEATURE_')) {
      continue;
    }

    const rawName = key.slice('FEATURE_'.length);
    if (rawName.length === 0) {
      throw new ConfigValidationError('FEATURE_ flag names must not be empty');
    }

    const normalized = rawName.toLowerCase();
    const value = secrets.getSecret(key);
    flags[normalized] = parseBooleanFlag(value, key);
  }

  return Object.freeze(flags);
}

function parseBooleanFlag(value: string | undefined, key: string): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  throw new ConfigValidationError(`${key} must be a boolean (true/false)`);
}
