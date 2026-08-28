import type { AppConfig } from './app-config.types';

let frozenConfig: AppConfig | undefined;

export function setAppConfig(config: AppConfig): void {
  frozenConfig = Object.freeze(config);
}

export function getAppConfig(): AppConfig {
  if (frozenConfig === undefined) {
    throw new Error('Application configuration has not been initialized');
  }

  return frozenConfig;
}

export function resetAppConfigForTests(): void {
  frozenConfig = undefined;
}
