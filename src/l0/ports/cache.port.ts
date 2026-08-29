export interface CacheService {
  connect(correlationId?: string): Promise<void>;
  disconnect(correlationId?: string): Promise<void>;
  ping(): Promise<boolean>;
  get(orgId: string, key: string): Promise<string | null>;
  set(orgId: string, key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(orgId: string, key: string): Promise<void>;
}
