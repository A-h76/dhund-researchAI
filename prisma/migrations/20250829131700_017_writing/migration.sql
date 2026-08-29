-- DHB-31 / Phase 2 §5.7–5.9 migration 017: writing schema
-- writings.current_version_id FK added after writing_versions exists (expand step).
-- citations.writing_id FK deferred from migration 011 (GAP-WRITING-01).

CREATE TABLE "writings" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "writing_type" NOT NULL,
    "status" "writing_status" NOT NULL DEFAULT 'draft',
    "current_version_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "writings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "writings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "writings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_writings_project_live" ON "writings"("project_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_writings_project_updated" ON "writings"("project_id", "updated_at" DESC);

CREATE TABLE "writing_versions" (
    "id" UUID NOT NULL,
    "writing_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "content_ref" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "writing_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "writing_versions_writing_id_version_no_key" UNIQUE ("writing_id", "version_no"),
    CONSTRAINT "writing_versions_writing_id_fkey" FOREIGN KEY ("writing_id") REFERENCES "writings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "writing_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TRIGGER "trg_writing_versions_reject_update"
    BEFORE UPDATE ON "writing_versions"
    FOR EACH ROW EXECUTE FUNCTION "trg_reject_update_append_only"();

ALTER TABLE "writings" ADD CONSTRAINT "writings_current_version_id_fkey"
    FOREIGN KEY ("current_version_id") REFERENCES "writing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "writing_sentence_bindings" (
    "id" UUID NOT NULL,
    "writing_id" UUID NOT NULL,
    "writing_version_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sentence_hash" TEXT NOT NULL,
    "evidence_id" UUID NOT NULL,
    "strength" NUMERIC NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "writing_sentence_bindings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "writing_sentence_bindings_writing_version_id_sentence_hash__key" UNIQUE ("writing_version_id", "sentence_hash", "evidence_id"),
    CONSTRAINT "writing_sentence_bindings_writing_id_fkey" FOREIGN KEY ("writing_id") REFERENCES "writings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "writing_sentence_bindings_writing_version_id_fkey" FOREIGN KEY ("writing_version_id") REFERENCES "writing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "writing_sentence_bindings_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_wsb_lookup" ON "writing_sentence_bindings"("writing_id", "sentence_hash");

ALTER TABLE "citations" ADD CONSTRAINT "citations_writing_id_fkey"
    FOREIGN KEY ("writing_id") REFERENCES "writings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
