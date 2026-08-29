-- DHB-31 / Phase 2 §10.10–10.11 migration 020: connector cache + reference manager imports

CREATE TABLE "connector_cache" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_cache_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connector_cache_provider_cache_key_key" UNIQUE ("provider", "cache_key")
);

CREATE INDEX "idx_connector_cache_expiry" ON "connector_cache"("expires_at");

CREATE TABLE "reference_manager_import_sessions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "initiated_by" UUID NOT NULL,
    "state" "import_session_state" NOT NULL DEFAULT 'CREATED',
    "items_total" INTEGER,
    "items_admitted" INTEGER NOT NULL DEFAULT 0,
    "items_rejected" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminal_at" TIMESTAMPTZ(3),

    CONSTRAINT "reference_manager_import_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refmgr_import_sessions_project_idempotency_key" UNIQUE ("project_id", "idempotency_key"),
    CONSTRAINT "chk_import_counts" CHECK ("items_admitted" >= 0 AND "items_rejected" >= 0),
    CONSTRAINT "reference_manager_import_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reference_manager_import_sessions_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_import_sessions_active" ON "reference_manager_import_sessions"("project_id", "state") WHERE "terminal_at" IS NULL;
