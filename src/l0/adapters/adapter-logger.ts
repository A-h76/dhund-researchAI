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
