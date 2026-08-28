import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from './app-config.types';
import { APP_CONFIG } from './config.tokens';

@Injectable()
export class FeatureFlagsService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isEnabled(flagName: string): boolean {
    const normalized = flagName.toLowerCase();
    return this.config.featureFlags[normalized] === true;
  }
}
