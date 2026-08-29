export { evaluateAuthorizationDecision } from './authorization-decision';
export { assertEmbeddingPolicy } from './embed-policy';
export type { EmbeddingSchemaMetadata } from './embed-policy';
export type { AppConfig, EmailConfig } from './app-config.types';
export { BootstrapValidationService } from './bootstrap-validation.service';
export { ConfigValidationError } from './config-validation.error';
export { loadAndValidateConfig } from './config.loader';
export { BootstrapModule } from './bootstrap.module';
export { ConfigModule } from './config.module';
export { getAppConfig, resetAppConfigForTests, setAppConfig } from './config.runtime';
export { APP_CONFIG } from './config.tokens';
export type { FrozenAppConfig } from './config.tokens';
export {
  parseDatabasePoolSize,
  parseEmbeddingDimension,
  parseFeatureFlags,
  parseLogLevel,
  parsePort,
  parseRequiredSecret,
  DEFAULT_DATABASE_POOL_SIZE,
  MAX_DATABASE_POOL_SIZE,
  MIN_DATABASE_POOL_SIZE,
} from './config.schema';
export {
  evaluateMigrationReadiness,
  listExpectedMigrationNames,
} from './migration-readiness.util';
export type { AppliedMigrationRecord } from './migration-readiness.util';
export { MigrationReadinessService } from './migration-readiness.service';
export {
  PROCESSOR_READINESS,
  type ProcessorReadinessProbe,
} from './processor-readiness.port';
export { ReadinessService } from './readiness.service';
export { FeatureFlagsService } from './feature-flags.service';
export { provideRuntimeRole, RUNTIME_ROLE } from './runtime-role.token';
