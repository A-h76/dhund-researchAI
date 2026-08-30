import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type {
  AiExecutionLedgerPort,
  AiExecutionLedgerRecord,
} from '../../ports/ai-execution-ledger.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaAiExecutionLedgerAdapter implements AiExecutionLedgerPort {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async record(input: AiExecutionLedgerRecord): Promise<void> {
    try {
      await this.database.recordAiExecutionLedger(input);
    } catch (error) {
      throw new L0OperationError('AI execution ledger write failed', error);
    }
  }
}
