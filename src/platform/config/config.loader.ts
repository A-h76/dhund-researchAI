import type { SecretsService } from '../../l0/ports/secrets.port';
import type { RuntimeRole } from '../runtime/role';
import { RuntimeRole as Role } from '../runtime/role';
import type { AppConfig } from './app-config.types';
import { ConfigValidationError } from './config-validation.error';
import {
  parseEmbeddingDimension,
  parseLogLevel,
  parsePort,
  parseRequiredSecret,
  parseFeatureFlags,
} from './config.schema';

export function loadAndValidateConfig(
  secrets: SecretsService,
  role: RuntimeRole,
): AppConfig {
  const loadedKeyNames: string[] = [];

  const track = (name: string, value: string | undefined): void => {
    if (value !== undefined) {
      loadedKeyNames.push(name);
    }
  };

  const databaseUrl = parseRequiredSecret(secrets, 'DATABASE_URL');
  track('DATABASE_URL', databaseUrl);

  const redisUrl = parseRequiredSecret(secrets, 'REDIS_URL');
  track('REDIS_URL', redisUrl);

  const portValue = secrets.getSecret('PORT');
  track('PORT', portValue);
  const port = parsePort(portValue, role === Role.Api);

  const logLevelValue = secrets.getSecret('LOG_LEVEL');
  track('LOG_LEVEL', logLevelValue);
  const logLevel = parseLogLevel(logLevelValue);

  const embeddingValue = secrets.getSecret('EMBEDDING_DIMENSION');
  track('EMBEDDING_DIMENSION', embeddingValue);
  const embeddingDimension = parseEmbeddingDimension(embeddingValue);

  const s3Endpoint = secrets.getSecret('S3_ENDPOINT');
  const s3Region = secrets.getSecret('S3_REGION');
  const s3AccessKeyId = secrets.getSecret('S3_ACCESS_KEY_ID');
  const s3SecretAccessKey = secrets.getSecret('S3_SECRET_ACCESS_KEY');
  const s3Bucket = secrets.getSecret('S3_BUCKET');
  track('S3_ENDPOINT', s3Endpoint);
  track('S3_REGION', s3Region);
  track('S3_ACCESS_KEY_ID', s3AccessKeyId);
  track('S3_SECRET_ACCESS_KEY', s3SecretAccessKey);
  track('S3_BUCKET', s3Bucket);

  const s3Values = [s3Endpoint, s3Region, s3AccessKeyId, s3SecretAccessKey, s3Bucket];
  const s3Provided = s3Values.filter((value) => value !== undefined);
  if (s3Provided.length > 0 && s3Provided.length < 5) {
    throw new ConfigValidationError(
      'S3 configuration is incomplete: provide S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET together',
    );
  }

  const resendApiKey = secrets.getSecret('RESEND_API_KEY');
  const emailFrom = secrets.getSecret('EMAIL_FROM');
  track('RESEND_API_KEY', resendApiKey);
  track('EMAIL_FROM', emailFrom);

  const emailValues = [resendApiKey, emailFrom];
  const emailProvided = emailValues.filter((value) => value !== undefined);
  if (emailProvided.length === 1) {
    throw new ConfigValidationError(
      'Email configuration is incomplete: provide both RESEND_API_KEY and EMAIL_FROM together',
    );
  }

  const featureFlags = parseFeatureFlags(secrets);
  for (const flagName of Object.keys(featureFlags)) {
    loadedKeyNames.push(`FEATURE_${flagName.toUpperCase()}`);
  }

  const config: AppConfig = {
    port,
    logLevel,
    databaseUrl,
    redisUrl,
    embeddingDimension,
    featureFlags,
    loadedKeyNames: [...new Set(loadedKeyNames)].sort(),
    ...(s3Provided.length === 5
      ? {
          s3: {
            endpoint: s3Endpoint!,
            region: s3Region ?? 'us-east-1',
            accessKeyId: s3AccessKeyId!,
            secretAccessKey: s3SecretAccessKey!,
            bucket: s3Bucket!,
          },
        }
      : {}),
    ...(emailProvided.length === 2
      ? {
          email: {
            resendApiKey: resendApiKey!,
            from: emailFrom!,
          },
        }
      : {}),
  };

  return Object.freeze(config);
}
