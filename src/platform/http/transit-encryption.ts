import { ConfigValidationError } from '../config/config-validation.error';

export function assertEncryptedTransit(databaseUrl: string, redisUrl: string): void {
  if (!redisUrl.startsWith('rediss://')) {
    throw new ConfigValidationError('REDIS_URL must use rediss:// when TRANSIT_TLS=require');
  }
  if (!/[?&]sslmode=require(?:&|$)/i.test(databaseUrl)) {
    throw new ConfigValidationError(
      'DATABASE_URL must set sslmode=require when TRANSIT_TLS=require',
    );
  }
}
