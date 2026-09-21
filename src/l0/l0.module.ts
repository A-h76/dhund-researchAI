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
  UPLOAD_SESSION_STORE,
  ORPHAN_SWEEP_STORE,
  EXTRACT_STORE,
  CHUNK_STORE,
  EMBEDDING_STORE,
  RETRIEVAL_INDEX,
  EVIDENCE_LOOKUP,
  RETRIEVAL_TRACE,
  IDENTITY_LOOKUP,
  PDF_PARSE_SERVICE,
  MESSAGE_EVIDENCE_BINDING,
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
import { PrismaUploadSessionAdapter } from './adapters/prisma/prisma-upload-session.adapter';
import { PrismaOrphanSweepAdapter } from './adapters/prisma/prisma-orphan-sweep.adapter';
import { PrismaExtractStoreAdapter } from './adapters/prisma/prisma-extract-store.adapter';
import { PrismaChunkStoreAdapter } from './adapters/prisma/prisma-chunk-store.adapter';
import { PrismaEmbeddingStoreAdapter } from './adapters/prisma/prisma-embedding-store.adapter';
import { PrismaRetrievalIndexAdapter } from './adapters/prisma/prisma-retrieval-index.adapter';
import { PrismaIdentityLookupAdapter } from './adapters/prisma/prisma-identity-lookup.adapter';
import { PrismaEvidenceLookupAdapter } from './adapters/prisma/prisma-evidence-lookup.adapter';
import { PrismaRetrievalTraceAdapter } from './adapters/prisma/prisma-retrieval-trace.adapter';
import { PrismaMessageEvidenceBindingAdapter } from './adapters/prisma/prisma-message-evidence-binding.adapter';
import { PrismaEvidenceSpineAdapter } from './adapters/prisma/prisma-evidence-spine.adapter';
import { PrismaCitationProjectionAdapter } from './adapters/prisma/prisma-citation-projection.adapter';
import { PrismaConnectorCacheAdapter } from './adapters/prisma/prisma-connector-cache.adapter';
import { PrismaConnectorSpineAdapter } from './adapters/prisma/prisma-connector-spine.adapter';
import { PdfjsParseAdapter } from './adapters/pdfjs/pdfjs-parse.adapter';
import { CITATION_PROJECTION } from './ports/citation-projection.port';
import { EVIDENCE_SPINE } from './ports/evidence-spine.port';
import { CONNECTOR_CACHE_STORE } from './ports/connector-cache.port';
import { CONNECTOR_SPINE_STORE } from './ports/connector-spine.port';

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
    PrismaUploadSessionAdapter,
    PrismaOrphanSweepAdapter,
    PrismaExtractStoreAdapter,
    PrismaChunkStoreAdapter,
    PrismaEmbeddingStoreAdapter,
    PrismaRetrievalIndexAdapter,
    PrismaEvidenceLookupAdapter,
    PrismaRetrievalTraceAdapter,
    PrismaMessageEvidenceBindingAdapter,
    PrismaEvidenceSpineAdapter,
    PrismaCitationProjectionAdapter,
    PrismaConnectorCacheAdapter,
    PrismaConnectorSpineAdapter,
    PrismaIdentityLookupAdapter,
    PdfjsParseAdapter,
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
    { provide: UPLOAD_SESSION_STORE, useExisting: PrismaUploadSessionAdapter },
    { provide: ORPHAN_SWEEP_STORE, useExisting: PrismaOrphanSweepAdapter },
    { provide: EXTRACT_STORE, useExisting: PrismaExtractStoreAdapter },
    { provide: CHUNK_STORE, useExisting: PrismaChunkStoreAdapter },
    { provide: EMBEDDING_STORE, useExisting: PrismaEmbeddingStoreAdapter },
    { provide: RETRIEVAL_INDEX, useExisting: PrismaRetrievalIndexAdapter },
    { provide: EVIDENCE_LOOKUP, useExisting: PrismaEvidenceLookupAdapter },
    { provide: RETRIEVAL_TRACE, useExisting: PrismaRetrievalTraceAdapter },
    { provide: MESSAGE_EVIDENCE_BINDING, useExisting: PrismaMessageEvidenceBindingAdapter },
    { provide: EVIDENCE_SPINE, useExisting: PrismaEvidenceSpineAdapter },
    { provide: CITATION_PROJECTION, useExisting: PrismaCitationProjectionAdapter },
    { provide: CONNECTOR_CACHE_STORE, useExisting: PrismaConnectorCacheAdapter },
    { provide: CONNECTOR_SPINE_STORE, useExisting: PrismaConnectorSpineAdapter },
    { provide: IDENTITY_LOOKUP, useExisting: PrismaIdentityLookupAdapter },
    { provide: PDF_PARSE_SERVICE, useExisting: PdfjsParseAdapter },
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
    UPLOAD_SESSION_STORE,
    ORPHAN_SWEEP_STORE,
    EXTRACT_STORE,
    CHUNK_STORE,
    EMBEDDING_STORE,
    RETRIEVAL_INDEX,
    EVIDENCE_LOOKUP,
    RETRIEVAL_TRACE,
    MESSAGE_EVIDENCE_BINDING,
    EVIDENCE_SPINE,
    CITATION_PROJECTION,
    CONNECTOR_CACHE_STORE,
    CONNECTOR_SPINE_STORE,
    IDENTITY_LOOKUP,
    PDF_PARSE_SERVICE,
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
