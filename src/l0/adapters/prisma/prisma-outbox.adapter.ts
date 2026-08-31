import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  OutboxInsertInput,
  OutboxPort,
  OutboxRow,
  OutboxTransaction,
} from '../../ports/outbox.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class PrismaOutboxAdapter implements OutboxPort {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async withTransaction<T>(work: (tx: OutboxTransaction) => Promise<T>): Promise<T> {
    await this.ensureConnected();
    try {
      return await this.client().$transaction(async (prismaTx) => {
        const handle = this.wrap(prismaTx);
        return work(handle);
      });
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }
      throw new L0OperationError('Outbox transaction failed', error);
    }
  }

  async append(tx: OutboxTransaction, input: OutboxInsertInput): Promise<void> {
    const prismaTx = this.unwrap(tx);
    try {
      await prismaTx.outbox.create({
        data: {
          id: input.id,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          eventType: input.eventType,
          schemaVersion: input.schemaVersion,
          payload: input.payload as Prisma.InputJsonValue,
          correlationId: input.correlationId,
        },
      });
    } catch (error) {
      throw new L0OperationError('Outbox append failed', error);
    }
  }

  async appendStateMarker(
    tx: OutboxTransaction,
    input: {
      id: string;
      action: string;
      correlationId: string;
      scope: Record<string, unknown>;
    },
  ): Promise<void> {
    const prismaTx = this.unwrap(tx);
    try {
      await prismaTx.auditEvent.create({
        data: {
          id: input.id,
          actorType: 'system',
          action: input.action,
          scope: input.scope as Prisma.InputJsonValue,
          correlationId: input.correlationId,
        },
      });
    } catch (error) {
      throw new L0OperationError('Outbox state marker append failed', error);
    }
  }

  async listUnrelayedOrdered(limit: number): Promise<readonly OutboxRow[]> {
    await this.ensureConnected();
    try {
      const rows = await this.client().outbox.findMany({
        where: { relayedAt: null },
        orderBy: [
          { aggregateType: 'asc' },
          { aggregateId: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: limit,
      });
      return rows.map((row) => this.toRow(row));
    } catch (error) {
      throw new L0OperationError('Outbox list unrelayed failed', error);
    }
  }

  async markRelayed(id: string, relayedAt: Date = new Date()): Promise<void> {
    await this.ensureConnected();
    try {
      await this.client().outbox.update({
        where: { id },
        data: { relayedAt },
      });
    } catch (error) {
      throw new L0OperationError('Outbox mark relayed failed', error);
    }
  }

  async incrementAttempt(id: string): Promise<void> {
    await this.ensureConnected();
    try {
      await this.client().outbox.update({
        where: { id },
        data: { attemptCount: { increment: 1 } },
      });
    } catch (error) {
      throw new L0OperationError('Outbox increment attempt failed', error);
    }
  }

  async countUnrelayed(): Promise<number> {
    await this.ensureConnected();
    try {
      return await this.client().outbox.count({ where: { relayedAt: null } });
    } catch (error) {
      throw new L0OperationError('Outbox count unrelayed failed', error);
    }
  }

  async oldestUnrelayedCreatedAt(): Promise<Date | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().outbox.findFirst({
        where: { relayedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      return row?.createdAt ?? null;
    } catch (error) {
      throw new L0OperationError('Outbox oldest unrelayed query failed', error);
    }
  }

  private client(): PrismaClient {
    return this.database.getPrismaClient();
  }

  private async ensureConnected(): Promise<void> {
    await this.database.connect();
  }

  private wrap(prismaTx: PrismaTx): OutboxTransaction {
    return prismaTx as unknown as OutboxTransaction;
  }

  private unwrap(tx: OutboxTransaction): PrismaTx {
    return tx as unknown as PrismaTx;
  }

  private toRow(row: {
    id: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    schemaVersion: number;
    payload: unknown;
    correlationId: string;
    createdAt: Date;
    relayedAt: Date | null;
    attemptCount: number;
  }): OutboxRow {
    return {
      id: row.id,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      eventType: row.eventType,
      schemaVersion: row.schemaVersion,
      payload: row.payload,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
      relayedAt: row.relayedAt,
      attemptCount: row.attemptCount,
    };
  }
}
