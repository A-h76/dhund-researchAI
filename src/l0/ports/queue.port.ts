export interface QueueService {
  connect(correlationId?: string): Promise<void>;
  disconnect(correlationId?: string): Promise<void>;
  ping(): Promise<boolean>;
  addJob<T extends Record<string, unknown>>(
    queueName: string,
    data: T,
  ): Promise<string>;
}
