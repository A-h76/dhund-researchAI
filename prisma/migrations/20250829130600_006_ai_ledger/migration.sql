-- DHB-30 / Phase 2 §6 migration 006: ai ledger
-- Run-scoped execution FK is deferred to migration 012 (expand step), not here.

CREATE TABLE "ai_executions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID,
    "capability" "ai_capability" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "input_fingerprint" TEXT NOT NULL,
    "status" "ai_status" NOT NULL,
    "method" "ai_method" NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_ai_cost_nonneg" CHECK ("cost_micros" >= 0),
    CONSTRAINT "ai_executions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_executions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_ai_executions_org_created" ON "ai_executions"("org_id", "created_at");
CREATE INDEX "idx_ai_executions_project" ON "ai_executions"("project_id");
CREATE INDEX "idx_ai_executions_capability_model" ON "ai_executions"("capability", "model");

CREATE TABLE "ai_execution_attempts" (
    "id" UUID NOT NULL,
    "ai_execution_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "ai_status" NOT NULL,
    "error" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "cost_micros" BIGINT NOT NULL,

    CONSTRAINT "ai_execution_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_execution_attempts_ai_execution_id_attempt_no_key" UNIQUE ("ai_execution_id", "attempt_no"),
    CONSTRAINT "ai_execution_attempts_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
