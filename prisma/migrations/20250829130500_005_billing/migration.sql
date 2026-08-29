-- DHB-29 / Phase 2 §3 migration 005: billing
-- plan_code stays TEXT (GAP-PLAN-01). No numeric plan caps.

CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id"),
    CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_subscriptions_org" ON "subscriptions"("org_id");

CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "metric" "usage_metric" NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_counters_org_id_period_metric_key" UNIQUE ("org_id", "period", "metric"),
    CONSTRAINT "chk_usage_period_order" CHECK ("period_end" > "period_start"),
    CONSTRAINT "usage_counters_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Stripe event id is the PK (TEXT) — documented exception to UUIDv7 PK convention.
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "status" "stripe_event_status" NOT NULL DEFAULT 'received',

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_stripe_events_unprocessed" ON "stripe_events"("received_at") WHERE "processed_at" IS NULL;

CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "response_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "idempotency_records_scope_key_key" UNIQUE ("scope", "key")
);

CREATE INDEX "idx_idempotency_created" ON "idempotency_records"("created_at");
