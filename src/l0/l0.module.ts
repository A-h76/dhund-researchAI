import { Module } from '@nestjs/common';
import { BullmqQueueAdapter } from './adapters/bullmq/bullmq-queue.adapter';
import { EnvSecretsAdapter } from './adapters/env/env-secrets.adapter';
import { PrismaDatabaseAdapter } from './adapters/prisma/prisma-database.adapter';
import { RedisCounterAdapter } from './adapters/redis/redis-counter.adapter';
import { RedisLeaseAdapter } from './adapters/redis/redis-lease.adapter';
import { RedisCacheAdapter } from './adapters/redis/redis-cache.adapter';
import { RedisPubSubAdapter } from './adapters/redis/redis-pubsub.adapter';
import { ResendEmailAdapter } from './adapters/resend/resend-email.adapter';
import { S3ObjectStorageAdapter } from './adapters/s3-compatible/s3-object-storage.adapter';
import {
  AI_EXECUTION_LEDGER,
  AUDIT_EVENT,
  CACHE_SERVICE,
  COUNTER_SERVICE,
  DATABASE_SERVICE,
  EMAIL_SERVICE,
  LEASE_SERVICE,
  OBJECT_STORAGE_SERVICE,
  OUTBOX_SERVICE,
  PUBSUB_SERVICE,
  QUEUE_SERVICE,
  SECRETS_SERVICE,
} from './ports/tokens';
import { PrismaAiExecutionLedgerAdapter } from './adapters/prisma/prisma-ai-execution-ledger.adapter';
import { PrismaAuditEventAdapter } from './adapters/prisma/prisma-audit-event.adapter';
import { PrismaOutboxAdapter } from './adapters/prisma/prisma-outbox.adapter';

@Module({
  providers: [
    EnvSecretsAdapter,
    PrismaDatabaseAdapter,
    PrismaAiExecutionLedgerAdapter,
    PrismaAuditEventAdapter,
    PrismaOutboxAdapter,
    RedisCacheAdapter,
    RedisCounterAdapter,
    RedisLeaseAdapter,
    RedisPubSubAdapter,
    BullmqQueueAdapter,
    S3ObjectStorageAdapter,
    ResendEmailAdapter,
    { provide: SECRETS_SERVICE, useExisting: EnvSecretsAdapter },
    { provide: DATABASE_SERVICE, useExisting: PrismaDatabaseAdapter },
    { provide: AI_EXECUTION_LEDGER, useExisting: PrismaAiExecutionLedgerAdapter },
    { provide: AUDIT_EVENT, useExisting: PrismaAuditEventAdapter },
    { provide: OUTBOX_SERVICE, useExisting: PrismaOutboxAdapter },
    { provide: CACHE_SERVICE, useExisting: RedisCacheAdapter },
    { provide: COUNTER_SERVICE, useExisting: RedisCounterAdapter },
    { provide: LEASE_SERVICE, useExisting: RedisLeaseAdapter },
    { provide: PUBSUB_SERVICE, useExisting: RedisPubSubAdapter },
    { provide: QUEUE_SERVICE, useExisting: BullmqQueueAdapter },
    { provide: OBJECT_STORAGE_SERVICE, useExisting: S3ObjectStorageAdapter },
    { provide: EMAIL_SERVICE, useExisting: ResendEmailAdapter },
  ],
  exports: [
    SECRETS_SERVICE,
    DATABASE_SERVICE,
    AI_EXECUTION_LEDGER,
    AUDIT_EVENT,
    OUTBOX_SERVICE,
    CACHE_SERVICE,
    COUNTER_SERVICE,
    LEASE_SERVICE,
    PUBSUB_SERVICE,
    QUEUE_SERVICE,
    OBJECT_STORAGE_SERVICE,
    EMAIL_SERVICE,
  ],
})
export class L0Module {}
