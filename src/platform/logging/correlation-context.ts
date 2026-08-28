import { AsyncLocalStorage } from 'node:async_hooks';

interface CorrelationStore {
  readonly correlationId: string;
}

const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function runWithCorrelationId<T>(
  correlationId: string,
  fn: () => T,
): T {
  return correlationStorage.run({ correlationId }, fn);
}

export async function runWithCorrelationIdAsync<T>(
  correlationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return correlationStorage.run({ correlationId }, fn);
}

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

export function requireCorrelationId(): string {
  const correlationId = getCorrelationId();
  if (correlationId === undefined) {
    throw new Error('correlationId is not available in the current context');
  }

  return correlationId;
}
