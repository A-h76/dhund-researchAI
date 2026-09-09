import type { Prisma } from '@prisma/client';
import type { OutboxTransaction } from '../../ports/outbox.port';

export function wrapOutboxTx(
  prismaTx: Prisma.TransactionClient,
): OutboxTransaction {
  return prismaTx as unknown as OutboxTransaction;
}

export function unwrapOutboxTx(
  tx: OutboxTransaction,
): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}
