import { Global, Module } from '@nestjs/common';
import type { L0ConnectionConfig } from '../../l0/ports/connection-config.port';
import { L0_CONNECTION_CONFIG } from '../../l0/ports/connection-config.port';
import { getAppConfig } from './config.runtime';
import { APP_CONFIG } from './config.tokens';
import { FeatureFlagsService } from './feature-flags.service';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): ReturnType<typeof getAppConfig> => getAppConfig(),
    },
    {
      provide: L0_CONNECTION_CONFIG,
      useFactory: (config: ReturnType<typeof getAppConfig>): L0ConnectionConfig => ({
        databaseUrl: config.databaseUrl,
        redisUrl: config.redisUrl,
        ...(config.s3 !== undefined ? { s3: config.s3 } : {}),
      }),
      inject: [APP_CONFIG],
    },
    FeatureFlagsService,
  ],
  exports: [APP_CONFIG, L0_CONNECTION_CONFIG, FeatureFlagsService],
})
export class ConfigModule {}
