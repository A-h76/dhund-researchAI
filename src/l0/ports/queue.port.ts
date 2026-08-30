export interface QueueBackoffPolicy {
  readonly type: 'exponential';
  readonly delayMs: number;
}

export interface QueueJobOptions {
  readonly jobId: string;
  readonly attempts?: number;
  readonly backoff?: QueueBackoffPolicy;
}

export interface QueueDepthSnapshot {
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
  readonly delayed: number;
}

export interface QueueService {
  connect(correlationId?: string): Promise<void>;
  disconnect(correlationId?: string): Promise<void>;
  ping(): Promise<boolean>;
  addJob<T extends Record<string, unknown>>(
    queueName: string,
    data: T,
    options: QueueJobOptions,
  ): Promise<string>;
  addDlqJob<T extends Record<string, unknown>>(
    dlqName: string,
    data: T,
    jobId: string,
  ): Promise<string>;
  getJobState(queueName: string, jobId: string): Promise<string | null>;
  retryFailedJob(queueName: string, jobId: string): Promise<'retried' | 'noop' | 'not_found'>;
  getQueueDepth(queueName: string): Promise<QueueDepthSnapshot>;
}
