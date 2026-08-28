import type { AppConfig } from './app-config.types';

export const APP_CONFIG = Symbol('APP_CONFIG');

export type FrozenAppConfig = Readonly<AppConfig>;
