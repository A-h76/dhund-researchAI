export type LeaseAcquireResult = 'acquired' | 'renewed' | 'contended';

export interface LeaseService {
  connect(correlationId?: string): Promise<void>;
  disconnect(correlationId?: string): Promise<void>;
  ping(): Promise<boolean>;
  tryAcquire(
    scope: string,
    key: string,
    holderId: string,
    ttlSeconds: number,
  ): Promise<LeaseAcquireResult>;
  renew(scope: string, key: string, holderId: string, ttlSeconds: number): Promise<boolean>;
  release(scope: string, key: string, holderId: string): Promise<boolean>;
  getHolder(scope: string, key: string): Promise<string | null>;
}
