-- DHB-31 / Phase 2 §8 migration 013: extraction matrix schema

CREATE TABLE "extraction_schemas" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_schemas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "extraction_schemas_project_id_name_version_key" UNIQUE ("project_id", "name", "version"),
    CONSTRAINT "extraction_schemas_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "extraction_runs" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "schema_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "document_ids" UUID[] NOT NULL,
    "state" "extraction_run_state" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "extraction_runs_run_id_key" UNIQUE ("run_id"),
    CONSTRAINT "extraction_runs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "extraction_runs_schema_id_fkey" FOREIGN KEY ("schema_id") REFERENCES "extraction_schemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_extraction_runs_state" ON "extraction_runs"("state");

CREATE TABLE "extraction_cells" (
    "id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "column_key" TEXT NOT NULL,
    "value" JSONB,
    "evidence_locator" JSONB,
    "ai_execution_id" UUID,
    "confidence" NUMERIC,
    "method" "extraction_method" NOT NULL,
    "status" "extraction_cell_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_cells_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "extraction_cells_extraction_run_id_document_id_column_key_key" UNIQUE ("extraction_run_id", "document_id", "column_key"),
    CONSTRAINT "chk_cell_llm_provenance" CHECK (
        "method" <> 'llm'::"extraction_method" OR "ai_execution_id" IS NOT NULL
    ),
    CONSTRAINT "extraction_cells_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "extraction_cells_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "extraction_cells_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_cells_run_status" ON "extraction_cells"("extraction_run_id", "status");
