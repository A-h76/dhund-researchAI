import { logSlowQuery } from './adapters/adapter-logger';
import type { SlowQueryEvent } from './ports/query-observer.port';

type CorrelationIdReader = () => string | undefined;
type SlowQueryHandler = (event: SlowQueryEvent) => void;

let readCorrelationId: CorrelationIdReader | undefined;
let onSlowQuery: SlowQueryHandler | undefined;

/**
 * Platform registers observability hooks without L0 importing platform (layering).
 */
export function registerQueryObservability(options: {
  readCorrelationId?: CorrelationIdReader;
  onSlowQuery?: SlowQueryHandler;
}): void {
  readCorrelationId = options.readCorrelationId;
  onSlowQuery = options.onSlowQuery;
}

export function resetQueryObservabilityForTests(): void {
  readCorrelationId = undefined;
  onSlowQuery = undefined;
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
  onSlowQuery?.(payload);
}
