import type { QueueBackoffPolicy } from '../../l0/ports/queue.port';
import type { QueueName } from './queue-names';

export type { QueueBackoffPolicy };

export type QueueAttemptsPolicy =
  | { readonly kind: 'fixed'; readonly attempts: number }
  | { readonly kind: 'infinite' }
  | { readonly kind: 'per-step-type'; readonly defaultAttempts: number };

export interface QueuePolicy {
  readonly name: QueueName;
  readonly attempts: QueueAttemptsPolicy;
  readonly backoff: QueueBackoffPolicy | null;
  readonly dlqName: string;
  readonly naturalKeyFields: readonly string[];
  readonly requiredPayloadFields: readonly string[];
  readonly r1Processor: boolean;
}

export interface DlqEntry {
  readonly originalJobId: string;
  readonly queue: QueueName;
  readonly orgId: string;
  readonly projectId?: string;
  readonly correlationId: string;
  readonly naturalKey: Record<string, unknown>;
  readonly errorMessage: string;
  readonly failedAt: string;
  readonly attemptCount: number;
}
