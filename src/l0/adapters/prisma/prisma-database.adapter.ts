import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  L0_CONNECTION_CONFIG,
  type L0ConnectionConfig,
} from '../../ports/connection-config.port';
import { logAdapterLifecycle } from '../adapter-logger';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type {
  AppliedMigrationRecord,
  DatabaseService,
} from '../../ports/database.port';

@Injectable()
export class PrismaDatabaseAdapter implements DatabaseService, OnModuleDestroy {
  private readonly client: PrismaClient;
  private connected = false;

  constructor(
    @Inject(L0_CONNECTION_CONFIG) connectionConfig: L0ConnectionConfig,
  ) {
    this.client = new PrismaClient({
      datasources: {
        db: {
          url: connectionConfig.databaseUrl,
        },
      },
    });
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

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }
}
