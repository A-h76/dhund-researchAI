export interface CounterService {
  connect(correlationId?: string): Promise<void>;
  disconnect(correlationId?: string): Promise<void>;
  ping(): Promise<boolean>;
  incrementIfBelow(key: string, max: number, ttlSeconds: number): Promise<boolean>;
  decrement(key: string): Promise<number>;
  get(key: string): Promise<number>;
}
