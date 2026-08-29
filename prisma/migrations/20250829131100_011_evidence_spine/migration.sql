-- DHB-30 / Phase 2 §5 migration 011: evidence spine
-- citations.writing_id FK is added in migration 017, not here.

CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "type" "source_type" NOT NULL,
    "document_id" UUID,
    "external_record_id" UUID,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_sources_exactly_one" CHECK (
        ("document_id" IS NOT NULL)::int + ("external_record_id" IS NOT NULL)::int = 1
    ),
    CONSTRAINT "chk_sources_type_match" CHECK (
        ("type" = 'document'::"source_type" AND "document_id" IS NOT NULL AND "external_record_id" IS NULL)
        OR ("type" = 'external_record'::"source_type" AND "external_record_id" IS NOT NULL AND "document_id" IS NULL)
    ),
    CONSTRAINT "sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sources_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sources_external_record_id_fkey" FOREIGN KEY ("external_record_id") REFERENCES "external_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_sources_document" ON "sources"("document_id") WHERE "document_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_sources_external_record" ON "sources"("external_record_id") WHERE "external_record_id" IS NOT NULL;
CREATE INDEX "idx_sources_project" ON "sources"("project_id");

CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "chunk_id" UUID,
    "locator" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "stance" "evidence_stance" NOT NULL DEFAULT 'unresolved',
    "polarity" SMALLINT,
    "quality_score" NUMERIC NOT NULL,
    "extraction_method" "extraction_method" NOT NULL,
    "ai_execution_id" UUID,
    "type" "evidence_type" NOT NULL,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_evidence_llm_provenance" CHECK (
        "extraction_method" <> 'llm'::"extraction_method" OR "ai_execution_id" IS NOT NULL
    ),
    CONSTRAINT "chk_evidence_body_grounded_chunk" CHECK (
        "type" <> 'body_grounded'::"evidence_type" OR "chunk_id" IS NOT NULL
    ),
    CONSTRAINT "chk_evidence_polarity" CHECK ("polarity" IS NULL OR "polarity" IN (-1, 0, 1)),
    CONSTRAINT "evidence_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "evidence_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "chunks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "evidence_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "evidence_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_evidence_project" ON "evidence"("project_id");
CREATE INDEX "idx_evidence_source" ON "evidence"("source_id");
CREATE INDEX "idx_evidence_chunk" ON "evidence"("chunk_id");
CREATE INDEX "idx_evidence_ai_execution" ON "evidence"("ai_execution_id");
CREATE INDEX "idx_evidence_current" ON "evidence"("project_id", "source_id") WHERE "superseded_by_id" IS NULL;

CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "coverage_annotation" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_claims_project_live" ON "claims"("project_id") WHERE "deleted_at" IS NULL;

CREATE TABLE "arguments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "structure" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "arguments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_arguments_project" ON "arguments"("project_id");

CREATE TABLE "evidence_claim_links" (
    "id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "weight" NUMERIC NOT NULL,
    "stance" "evidence_stance" NOT NULL,

    CONSTRAINT "evidence_claim_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evidence_claim_links_evidence_id_claim_id_key" UNIQUE ("evidence_id", "claim_id"),
    CONSTRAINT "evidence_claim_links_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "evidence_claim_links_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_ecl_claim" ON "evidence_claim_links"("claim_id");

CREATE TABLE "argument_claim_links" (
    "id" UUID NOT NULL,
    "argument_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" TEXT,
    "ordinal" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "argument_claim_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "argument_claim_links_argument_id_claim_id_key" UNIQUE ("argument_id", "claim_id"),
    CONSTRAINT "argument_claim_links_argument_id_fkey" FOREIGN KEY ("argument_id") REFERENCES "arguments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "argument_claim_links_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_acl_claim" ON "argument_claim_links"("claim_id");
CREATE INDEX "idx_acl_project" ON "argument_claim_links"("project_id");

CREATE TABLE "citations" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "writing_id" UUID,
    "resolves_to_evidence_id" UUID,
    "resolves_to_source_id" UUID,
    "csl_json" JSONB NOT NULL,
    "quality_annotation" "evidence_type" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_citations_resolves_one" CHECK (
        ("resolves_to_evidence_id" IS NOT NULL)::int + ("resolves_to_source_id" IS NOT NULL)::int = 1
    ),
    CONSTRAINT "citations_resolves_to_evidence_id_fkey" FOREIGN KEY ("resolves_to_evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "citations_resolves_to_source_id_fkey" FOREIGN KEY ("resolves_to_source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_citations_project" ON "citations"("project_id");
CREATE INDEX "idx_citations_writing" ON "citations"("writing_id") WHERE "writing_id" IS NOT NULL;
