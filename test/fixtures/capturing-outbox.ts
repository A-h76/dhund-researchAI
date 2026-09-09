import type { OutboxInsertInput, OutboxPort } from '../../src/l0/ports/outbox.port';

export function capturingOutbox(): {
  outbox: OutboxPort;
  appended: OutboxInsertInput[];
} {
  const appended: OutboxInsertInput[] = [];
  const outbox: OutboxPort = {
    withTransaction: async (work) => work({} as never),
    append: async (_tx, input) => {
      appended.push(input);
    },
    appendStateMarker: async () => undefined,
    listUnrelayedOrdered: async () => [],
    markRelayed: async () => undefined,
    incrementAttempt: async () => undefined,
    countUnrelayed: async () => 0,
    oldestUnrelayedCreatedAt: async () => null,
  };
  return { outbox, appended };
}
