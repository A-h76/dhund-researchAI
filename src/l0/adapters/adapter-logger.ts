export type AdapterLifecycleEvent = 'connect' | 'disconnect';

export function logAdapterLifecycle(
  adapter: string,
  event: AdapterLifecycleEvent,
  correlationId?: string,
): void {
  const payload: Record<string, string> = {
    msg: 'l0.adapter.lifecycle',
    adapter,
    event,
  };

  if (correlationId !== undefined) {
    payload.correlationId = correlationId;
  }

  console.log(JSON.stringify(payload));
}

export function logSlowQuery(event: {
  durationMs: number;
  operation: string;
  model?: string;
  correlationId?: string;
}): void {
  const payload: Record<string, string | number> = {
    msg: 'db.slow_query',
    durationMs: event.durationMs,
    operation: event.operation,
  };

  if (event.model !== undefined) {
    payload.model = event.model;
  }

  if (event.correlationId !== undefined) {
    payload.correlationId = event.correlationId;
  }

  console.log(JSON.stringify(payload));
}
