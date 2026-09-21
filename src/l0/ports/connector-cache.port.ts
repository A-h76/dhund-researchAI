export interface ConnectorCacheEntry {
  readonly provider: string;
  readonly cacheKey: string;
  readonly value: unknown;
  readonly expiresAt: Date;
}

export interface ConnectorCacheStore {
  get(provider: string, cacheKey: string): Promise<ConnectorCacheEntry | null>;
  set(input: {
    readonly provider: string;
    readonly cacheKey: string;
    readonly value: unknown;
    readonly expiresAt: Date;
  }): Promise<void>;
  delete(provider: string, cacheKey: string): Promise<void>;
}

export const CONNECTOR_CACHE_STORE = Symbol('CONNECTOR_CACHE_STORE');
