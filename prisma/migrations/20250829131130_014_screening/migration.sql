-- DHB-31 / Phase 2 §9 migration 014: screening schema + append-only trigger

CREATE OR REPLACE FUNCTION "trg_screening_decisions_append_only"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'DELETE rejected: append-only table screening_decisions';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD."id" IS DISTINCT FROM NEW."id"
            OR OLD."project_id" IS DISTINCT FROM NEW."project_id"
            OR OLD."run_id" IS DISTINCT FROM NEW."run_id"
            OR OLD."source_id" IS DISTINCT FROM NEW."source_id"
            OR OLD."decision" IS DISTINCT FROM NEW."decision"
            OR OLD."reason" IS DISTINCT FROM NEW."reason"
            OR OLD."criteria_id" IS DISTINCT FROM NEW."criteria_id"
            OR OLD."criteria_version" IS DISTINCT FROM NEW."criteria_version"
            OR OLD."method" IS DISTINCT FROM NEW."method"
            OR OLD."ai_execution_id" IS DISTINCT FROM NEW."ai_execution_id"
             OR OLD."confidence" IS DISTINCT FROM NEW."confidence"
            OR OLD."evidence_locator" IS DISTINCT FROM NEW."evidence_locator"
            OR OLD."decided_by" IS DISTINCT FROM NEW."decided_by"
            OR OLD."decided_at" IS DISTINCT FROM NEW."decided_at"
        THEN
            RAISE EXCEPTION 'UPDATE rejected: append-only table screening_decisions';
        END IF;

        IF OLD."superseded_by_decision_id" IS NOT NULL
            AND OLD."superseded_by_decision_id" IS DISTINCT FROM NEW."superseded_by_decision_id"
        THEN
            RAISE EXCEPTION 'UPDATE rejected: superseded_by_decision_id is immutable once set';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "screening_criteria" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "run_id" UUID,
    "definition" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_criteria_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screening_criteria_project_id_version_key" UNIQUE ("project_id", "version"),
    CONSTRAINT "screening_criteria_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "screening_criteria_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "screening_criteria_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "screening_decisions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "run_id" UUID,
    "source_id" UUID NOT NULL,
    "decision" "screening_decision_kind" NOT NULL,
    "reason" TEXT,
    "criteria_id" UUID,
    "criteria_version" INTEGER,
    "method" "extraction_method" NOT NULL,
    "ai_execution_id" UUID,
    "confidence" NUMERIC,
    "evidence_locator" JSONB,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL,
    "superseded_by_decision_id" UUID,

    CONSTRAINT "screening_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screening_decisions_run_id_source_id_criteria_version_key" UNIQUE ("run_id", "source_id", "criteria_version"),
    CONSTRAINT "chk_screening_llm_provenance" CHECK (
        "method" <> 'llm'::"extraction_method" OR "ai_execution_id" IS NOT NULL
    ),
    CONSTRAINT "screening_decisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "screening_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "screening_decisions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "screening_decisions_criteria_id_fkey" FOREIGN KEY ("criteria_id") REFERENCES "screening_criteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "screening_decisions_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "screening_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "screening_decisions_superseded_by_decision_id_fkey" FOREIGN KEY ("superseded_by_decision_id") REFERENCES "screening_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_screening_current" ON "screening_decisions"("source_id", "run_id")
    WHERE "superseded_by_decision_id" IS NULL;
CREATE INDEX "idx_screening_project_current" ON "screening_decisions"("project_id")
    WHERE "superseded_by_decision_id" IS NULL;

CREATE TRIGGER "trg_screening_decisions_append_only"
    BEFORE UPDATE OR DELETE ON "screening_decisions"
    FOR EACH ROW EXECUTE FUNCTION "trg_screening_decisions_append_only"();
