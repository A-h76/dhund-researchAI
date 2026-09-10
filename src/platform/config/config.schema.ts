import {
  HNSW_EF_SEARCH_DEFAULT,
  HNSW_EF_SEARCH_MAX,
  HNSW_EF_SEARCH_MIN,
} from '../../l0/ports/hnsw.constants';
import {
  InvalidHnswEfSearchError,
  resolveHnswEfSearch,
} from '../../l0/ports/hnsw-ef-search';
import type { SecretsService } from '../../l0/ports/secrets.port';
import { RuntimeRole } from '../runtime/role';
import type { JwtConfig } from './app-config.types';
import { ConfigValidationError } from './config-validation.error';

const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

export function parseJwtConfig(
  secrets: SecretsService,
  role: RuntimeRole,
): JwtConfig | undefined {
  const privateKey = secrets.getSecret('AUTH_JWT_PRIVATE_KEY');
  const kidRaw = secrets.getSecret('AUTH_JWT_KID');
  const provided = [privateKey, kidRaw].filter((value) => value !== undefined);

  if (role === RuntimeRole.Api) {
    if (privateKey === undefined) {
      throw new ConfigValidationError('Missing required configuration: AUTH_JWT_PRIVATE_KEY');
    }
    if (kidRaw === undefined) {
      throw new ConfigValidationError('Missing required configuration: AUTH_JWT_KID');
    }
    return validatedJwtConfig(privateKey, kidRaw);
  }

  if (provided.length === 1) {
    throw new ConfigValidationError(
      'JWT configuration is incomplete: provide both AUTH_JWT_PRIVATE_KEY and AUTH_JWT_KID together',
    );
  }

  if (provided.length === 0) {
    return undefined;
  }

  return validatedJwtConfig(privateKey!, kidRaw!);
}

const TOTP_WRAP_KEY_BYTES = 32;

export function parseTotpWrapKey(
  secrets: SecretsService,
  role: RuntimeRole,
): Uint8Array | undefined {
  const raw = secrets.getSecret('AUTH_TOTP_WRAP_KEY');
  if (role === RuntimeRole.Api) {
    if (raw === undefined) {
      throw new ConfigValidationError('Missing required configuration: AUTH_TOTP_WRAP_KEY');
    }
    return validatedTotpWrapKey(raw);
  }
  if (raw === undefined) {
    return undefined;
  }
  return validatedTotpWrapKey(raw);
}

function validatedTotpWrapKey(raw: string): Uint8Array {
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== TOTP_WRAP_KEY_BYTES) {
    throw new ConfigValidationError('AUTH_TOTP_WRAP_KEY must be 32 bytes of base64');
  }
  return new Uint8Array(decoded);
}

function validatedJwtConfig(privateKey: string, kidRaw: string): JwtConfig {
  const kid = kidRaw.trim();
  if (kid.length === 0) {
    throw new ConfigValidationError('AUTH_JWT_KID must be a non-empty key id');
  }
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new ConfigValidationError('AUTH_JWT_PRIVATE_KEY must be a PKCS8 private key');
  }
  return { privateKey, kid };
}

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

/** Runtime HNSW search-list size. Not an index rebuild. */
export function parseHnswEfSearch(value: string | undefined): number {
  if (value === undefined) {
    return HNSW_EF_SEARCH_DEFAULT;
  }
  const parsed = Number(value);
  try {
    return resolveHnswEfSearch(parsed);
  } catch (error) {
    if (error instanceof InvalidHnswEfSearchError) {
      throw new ConfigValidationError(
        `HNSW_EF_SEARCH must be an integer between ${HNSW_EF_SEARCH_MIN} and ${HNSW_EF_SEARCH_MAX}`,
      );
    }
    throw error;
  }
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
