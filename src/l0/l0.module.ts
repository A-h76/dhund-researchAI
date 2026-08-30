import { Module } from '@nestjs/common';
import { BullmqQueueAdapter } from './adapters/bullmq/bullmq-queue.adapter';
import { EnvSecretsAdapter } from './adapters/env/env-secrets.adapter';
import { PrismaDatabaseAdapter } from './adapters/prisma/prisma-database.adapter';
import { RedisCacheAdapter } from './adapters/redis/redis-cache.adapter';
import { ResendEmailAdapter } from './adapters/resend/resend-email.adapter';
import { S3ObjectStorageAdapter } from './adapters/s3-compatible/s3-object-storage.adapter';
import {
  AI_EXECUTION_LEDGER,
  CACHE_SERVICE,
  DATABASE_SERVICE,
  EMAIL_SERVICE,
  OBJECT_STORAGE_SERVICE,
  QUEUE_SERVICE,
  SECRETS_SERVICE,
} from './ports/tokens';
import { PrismaAiExecutionLedgerAdapter } from './adapters/prisma/prisma-ai-execution-ledger.adapter';

@Module({
  providers: [
    EnvSecretsAdapter,
    PrismaDatabaseAdapter,
    PrismaAiExecutionLedgerAdapter,
    RedisCacheAdapter,
    BullmqQueueAdapter,
    S3ObjectStorageAdapter,
    ResendEmailAdapter,
    { provide: SECRETS_SERVICE, useExisting: EnvSecretsAdapter },
    { provide: DATABASE_SERVICE, useExisting: PrismaDatabaseAdapter },
    { provide: AI_EXECUTION_LEDGER, useExisting: PrismaAiExecutionLedgerAdapter },
    { provide: CACHE_SERVICE, useExisting: RedisCacheAdapter },
    { provide: QUEUE_SERVICE, useExisting: BullmqQueueAdapter },
    { provide: OBJECT_STORAGE_SERVICE, useExisting: S3ObjectStorageAdapter },
    { provide: EMAIL_SERVICE, useExisting: ResendEmailAdapter },
  ],
  exports: [
    SECRETS_SERVICE,
    DATABASE_SERVICE,
    AI_EXECUTION_LEDGER,
    CACHE_SERVICE,
    QUEUE_SERVICE,
    OBJECT_STORAGE_SERVICE,
    EMAIL_SERVICE,
  ],
})
export class L0Module {}
