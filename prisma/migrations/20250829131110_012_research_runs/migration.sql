-- DHB-31 / Phase 2 §7 migration 012: orchestration
-- ai_executions.research_run_id expand-step FK added here, not in migration 006.

CREATE TABLE "research_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "initiated_by" UUID NOT NULL,
    "preset" "research_run_preset" NOT NULL,
    "custom_dag" JSONB,
    "state" "research_run_state" NOT NULL DEFAULT 'CREATED',
    "reserved_micros" BIGINT NOT NULL,
    "consumed_micros" BIGINT NOT NULL DEFAULT 0,
    "coverage" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "terminal_at" TIMESTAMPTZ(3),

    CONSTRAINT "research_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "research_runs_project_id_idempotency_key_key" UNIQUE ("project_id", "idempotency_key"),
    CONSTRAINT "chk_runs_micros" CHECK ("reserved_micros" >= 0 AND "consumed_micros" >= 0),
    CONSTRAINT "chk_runs_custom_dag" CHECK (
        ("preset" = 'custom'::"research_run_preset") = ("custom_dag" IS NOT NULL)
    ),
    CONSTRAINT "research_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "research_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "research_runs_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_research_runs_active" ON "research_runs"("project_id", "state") WHERE "terminal_at" IS NULL;
CREATE INDEX "idx_research_runs_org_state" ON "research_runs"("org_id", "state");

CREATE TABLE "research_run_steps" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_type" TEXT NOT NULL,
    "depends_on_step_ids" UUID[] NOT NULL DEFAULT '{}',
    "input_fingerprint" TEXT NOT NULL,
    "step_version" TEXT NOT NULL,
    "state" "research_step_state" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "heartbeat_at" TIMESTAMPTZ(3),
    "result_ref" TEXT,
    "priority_score" NUMERIC,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_run_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "research_run_steps_run_id_step_type_input_fingerprint_step__key" UNIQUE ("run_id", "step_type", "input_fingerprint", "step_version"),
    CONSTRAINT "research_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_steps_dispatch" ON "research_run_steps"("run_id", "state");
CREATE INDEX "idx_steps_reaper" ON "research_run_steps"("state", "heartbeat_at") WHERE "state" = 'DISPATCHED';
CREATE INDEX "idx_steps_deferred_priority" ON "research_run_steps"("run_id", "priority_score" DESC) WHERE "state" = 'DEFERRED';

CREATE TABLE "research_artifacts" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "type" "research_artifact_type" NOT NULL,
    "coverage_snapshot" JSONB NOT NULL,
    "coverage_snapshot_hash" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "storage_key" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "research_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "research_artifacts_run_id_type_coverage_snapshot_hash_key" UNIQUE ("run_id", "type", "coverage_snapshot_hash"),
    CONSTRAINT "research_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_artifacts_run" ON "research_artifacts"("run_id");

ALTER TABLE "ai_executions" ADD COLUMN "research_run_id" UUID;

ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_research_run_id_fkey"
    FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_ai_executions_research_run" ON "ai_executions"("research_run_id");
