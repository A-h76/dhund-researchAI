export const CACHE_SERVICE = Symbol('CACHE_SERVICE');

export interface CacheService {
  ping(): Promise<boolean>;
}
