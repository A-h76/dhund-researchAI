import { Module } from '@nestjs/common';
import { BullmqQueueAdapter } from './adapters/bullmq/bullmq-queue.adapter';
import { EnvSecretsAdapter } from './adapters/env/env-secrets.adapter';
import { HibpBreachListAdapter } from './adapters/hibp/hibp-breach-list.adapter';
import { PrismaDatabaseAdapter } from './adapters/prisma/prisma-database.adapter';
import { RedisCounterAdapter } from './adapters/redis/redis-counter.adapter';
import { RedisLeaseAdapter } from './adapters/redis/redis-lease.adapter';
import { RedisCacheAdapter } from './adapters/redis/redis-cache.adapter';
import { RedisAccessContextInvalidator } from './adapters/redis/redis-access-context-invalidator';
import { RedisPubSubAdapter } from './adapters/redis/redis-pubsub.adapter';
import { ResendEmailAdapter } from './adapters/resend/resend-email.adapter';
import { S3ObjectStorageAdapter } from './adapters/s3-compatible/s3-object-storage.adapter';
import {
  AI_EXECUTION_LEDGER,
  AUDIT_EVENT,
  BREACH_LIST,
  CACHE_SERVICE,
  COUNTER_SERVICE,
  DATABASE_SERVICE,
  EMAIL_SERVICE,
  LEASE_SERVICE,
  OBJECT_STORAGE_SERVICE,
  OUTBOX_SERVICE,
  PUBSUB_SERVICE,
  QUEUE_SERVICE,
  REGISTRATION_STORE,
  SESSION_STORE,
  AUTH_TOKEN_STORE,
  MFA_STORE,
  TENANCY_STORE,
  ACCESS_CONTEXT_INVALIDATOR,
  SCOPED_STORE,
  PROJECT_ERASURE_STORE,
  SECRETS_SERVICE,
} from './ports/tokens';
import { PrismaAiExecutionLedgerAdapter } from './adapters/prisma/prisma-ai-execution-ledger.adapter';
import { PrismaAuditEventAdapter } from './adapters/prisma/prisma-audit-event.adapter';
import { PrismaAuthTokenAdapter } from './adapters/prisma/prisma-auth-token.adapter';
import { PrismaMfaAdapter } from './adapters/prisma/prisma-mfa.adapter';
import { PrismaProjectErasureAdapter } from './adapters/prisma/prisma-project-erasure.adapter';
import { PrismaScopedStoreAdapter } from './adapters/prisma/prisma-scoped-store.adapter';
import { PrismaTenancyAdapter } from './adapters/prisma/prisma-tenancy.adapter';
import { PrismaOutboxAdapter } from './adapters/prisma/prisma-outbox.adapter';
import { PrismaRegistrationAdapter } from './adapters/prisma/prisma-registration.adapter';
import { PrismaSessionAdapter } from './adapters/prisma/prisma-session.adapter';

@Module({
  providers: [
    EnvSecretsAdapter,
    PrismaDatabaseAdapter,
    PrismaAiExecutionLedgerAdapter,
    PrismaAuditEventAdapter,
    PrismaOutboxAdapter,
    PrismaRegistrationAdapter,
    PrismaSessionAdapter,
    PrismaAuthTokenAdapter,
    PrismaMfaAdapter,
    PrismaTenancyAdapter,
    PrismaScopedStoreAdapter,
    PrismaProjectErasureAdapter,
    RedisAccessContextInvalidator,
    HibpBreachListAdapter,
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
    { provide: REGISTRATION_STORE, useExisting: PrismaRegistrationAdapter },
    { provide: SESSION_STORE, useExisting: PrismaSessionAdapter },
    { provide: AUTH_TOKEN_STORE, useExisting: PrismaAuthTokenAdapter },
    { provide: MFA_STORE, useExisting: PrismaMfaAdapter },
    { provide: TENANCY_STORE, useExisting: PrismaTenancyAdapter },
    { provide: SCOPED_STORE, useExisting: PrismaScopedStoreAdapter },
    { provide: PROJECT_ERASURE_STORE, useExisting: PrismaProjectErasureAdapter },
    {
      provide: ACCESS_CONTEXT_INVALIDATOR,
      useExisting: RedisAccessContextInvalidator,
    },
    { provide: BREACH_LIST, useExisting: HibpBreachListAdapter },
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
    REGISTRATION_STORE,
    SESSION_STORE,
    AUTH_TOKEN_STORE,
    MFA_STORE,
    TENANCY_STORE,
    SCOPED_STORE,
    PROJECT_ERASURE_STORE,
    ACCESS_CONTEXT_INVALIDATOR,
    BREACH_LIST,
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
