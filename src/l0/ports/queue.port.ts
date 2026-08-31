export interface QueueBackoffPolicy {
  readonly type: 'exponential';
  readonly delayMs: number;
}

export interface QueueJobOptions {
  readonly jobId: string;
  readonly attempts?: number;
  readonly backoff?: QueueBackoffPolicy;
  readonly delayMs?: number;
}

export interface QueueDepthSnapshot {
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
  readonly delayed: number;
}

export interface QueueJobContext {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly attemptsMade: number;
  readonly attempts: number;
}

export type QueueJobProcessor = (job: QueueJobContext) => Promise<void>;

export interface QueueWorkerHandle {
  close(): Promise<void>;
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
  /** Start a durable consumer for a queue (BullMQ Worker behind the port). */
  processJobs(
    queueName: string,
    processor: QueueJobProcessor,
    options?: { concurrency?: number },
  ): Promise<QueueWorkerHandle>;
}
