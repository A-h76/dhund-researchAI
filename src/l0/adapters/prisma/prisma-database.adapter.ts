import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  L0_CONNECTION_CONFIG,
  type L0ConnectionConfig,
} from '../../ports/connection-config.port';
import { isSlowQuery } from '../../ports/query-observer.port';
import { emitSlowQuery } from '../../observability-bridge';
import { logAdapterLifecycle } from '../adapter-logger';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type {
  AppliedMigrationRecord,
  DatabasePoolInfo,
  DatabaseService,
} from '../../ports/database.port';
import type { AiExecutionLedgerRecord } from '../../ports/ai-execution-ledger.port';
import { mapLedgerRecordToPrismaCreate } from './prisma-ai-execution-ledger.mapper';
import { withPrismaPoolSize } from './prisma-pool-url';

@Injectable()
export class PrismaDatabaseAdapter implements DatabaseService, OnModuleDestroy {
  private readonly client: PrismaClient;
  private readonly poolSize: number;
  private connected = false;
  private slowQueryCount = 0;

  constructor(
    @Inject(L0_CONNECTION_CONFIG) connectionConfig: L0ConnectionConfig,
  ) {
    this.poolSize = connectionConfig.databasePoolSize;
    const datasourceUrl = withPrismaPoolSize(
      connectionConfig.databaseUrl,
      this.poolSize,
    );

    const base = new PrismaClient({
      datasources: {
        db: {
          url: datasourceUrl,
        },
      },
    });

    this.client = base.$extends({
      query: {
        $allOperations: async ({ operation, model, args, query }) => {
          const started = Date.now();
          try {
            return await query(args);
          } finally {
            const durationMs = Date.now() - started;
            if (isSlowQuery(durationMs)) {
              this.slowQueryCount += 1;
              emitSlowQuery({
                durationMs,
                operation,
                ...(model !== undefined ? { model } : {}),
              });
            }
          }
        },
      },
    }) as unknown as PrismaClient;
  }

  getPoolInfo(): DatabasePoolInfo {
    return { configuredSize: this.poolSize };
  }

  getSlowQueryCount(): number {
    return this.slowQueryCount;
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(correlationId?: string): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      await this.client.$connect();
      this.connected = true;
      logAdapterLifecycle('database', 'connect', correlationId);
    } catch (error) {
      throw new L0ConnectionError('Database connection failed', error);
    }
  }

  async disconnect(correlationId?: string): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.client.$disconnect();
      this.connected = false;
      logAdapterLifecycle('database', 'disconnect', correlationId);
    } catch (error) {
      throw new L0ConnectionError('Database disconnect failed', error);
    }
  }

  async ping(): Promise<boolean> {
    await this.ensureConnected();

    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      throw new L0OperationError('Database ping failed', error);
    }
  }

  async listAppliedMigrations(): Promise<readonly AppliedMigrationRecord[]> {
    await this.ensureConnected();

    try {
      const rows = await this.client.$queryRaw<
        Array<{
          migration_name: string;
          finished_at: Date | null;
          rolled_back_at: Date | null;
        }>
      >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;

      return rows.map((row) => ({
        migrationName: row.migration_name,
        finishedAt: row.finished_at,
        rolledBackAt: row.rolled_back_at,
      }));
    } catch {
      return [];
    }
  }

  async recordAiExecutionLedger(input: AiExecutionLedgerRecord): Promise<void> {
    await this.ensureConnected();

    const { execution, attempts } = mapLedgerRecordToPrismaCreate(input);

    await this.client.$transaction(async (tx) => {
      await tx.aiExecution.create({ data: execution });
      await tx.aiExecutionAttempt.createMany({ data: attempts });

      if (input.researchRunId !== undefined && input.costMicros > 0) {
        await tx.researchRun.update({
          where: { id: input.researchRunId },
          data: {
            consumedMicros: {
              increment: BigInt(input.costMicros),
            },
          },
        });
      }
    });
  }

  /** Escape hatch for L0 Prisma adapters that share this connection. */
  getPrismaClient(): PrismaClient {
    return this.client;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }
}
