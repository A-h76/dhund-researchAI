import { logSlowQuery } from './adapters/adapter-logger';
import type { SlowQueryEvent } from './ports/query-observer.port';

type CorrelationIdReader = () => string | undefined;
type SlowQueryHandler = (event: SlowQueryEvent) => void;

export interface QueueJobObservation {
  readonly queue: string;
  readonly waitMs: number;
  readonly processMs: number;
  readonly retry: number;
}

type QueueJobHandler = (event: QueueJobObservation) => void;

let readCorrelationId: CorrelationIdReader | undefined;
const slowQueryHandlers: SlowQueryHandler[] = [];
let onQueueJob: QueueJobHandler | undefined;

/**
 * Platform registers observability hooks without L0 importing platform (layering).
 */
export function registerQueryObservability(options: {
  readCorrelationId?: CorrelationIdReader;
  onSlowQuery?: SlowQueryHandler;
}): void {
  if (options.readCorrelationId !== undefined) {
    readCorrelationId = options.readCorrelationId;
  }
  if (options.onSlowQuery !== undefined) {
    slowQueryHandlers.push(options.onSlowQuery);
  }
}

export function registerQueueObservation(handler: QueueJobHandler): void {
  onQueueJob = handler;
}

export function resetQueryObservabilityForTests(): void {
  readCorrelationId = undefined;
  slowQueryHandlers.length = 0;
  onQueueJob = undefined;
}

export function emitQueueJob(event: QueueJobObservation): void {
  onQueueJob?.(event);
}

export function emitSlowQuery(event: {
  durationMs: number;
  operation: string;
  model?: string;
}): void {
  const correlationId = readCorrelationId?.();
  const payload: SlowQueryEvent = {
    durationMs: event.durationMs,
    operation: event.operation,
    ...(event.model !== undefined ? { model: event.model } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  };

  logSlowQuery(payload);
  for (const handler of slowQueryHandlers) {
    handler(payload);
  }
}
