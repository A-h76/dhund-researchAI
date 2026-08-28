import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { logAdapterLifecycle } from '../adapter-logger';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type { DatabaseService } from '../../ports/database.port';

@Injectable()
export class PrismaDatabaseAdapter implements DatabaseService, OnModuleDestroy {
  private readonly client = new PrismaClient();
  private connected = false;

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

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }
}
