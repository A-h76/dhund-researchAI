-- DHB-30 / Phase 2 §4 migration 009: ingestion
-- FTS/search_vector and document trigram indexes belong in migration 016, not here.

CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "initiated_by" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "upload_session_status" NOT NULL DEFAULT 'issued',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "upload_sessions_storage_key_key" UNIQUE ("storage_key"),
    CONSTRAINT "chk_upload_filename" CHECK (
        length("filename") <= 255
        AND "filename" NOT LIKE '%/%'
        AND position(E'\x00' in "filename") = 0
    ),
    CONSTRAINT "upload_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "upload_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "upload_sessions_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_upload_sessions_sweep" ON "upload_sessions"("expires_at") WHERE "status" = 'issued';

CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT[] NOT NULL DEFAULT '{}',
    "year" INTEGER,
    "venue" TEXT,
    "doi" TEXT,
    "pmid" TEXT,
    "arxiv_id" TEXT,
    "abstract" TEXT,
    "canonical_work_id" UUID,
    "storage_key" TEXT NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'queued',
    "rights_snapshot_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_documents_storage_key" UNIQUE ("project_id", "storage_key"),
    CONSTRAINT "documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "documents_canonical_work_id_fkey" FOREIGN KEY ("canonical_work_id") REFERENCES "canonical_works"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_rights_snapshot_id_fkey" FOREIGN KEY ("rights_snapshot_id") REFERENCES "rights_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_documents_project_doi" ON "documents"("project_id", "doi")
    WHERE "doi" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "idx_documents_project_status" ON "documents"("project_id", "status");
CREATE INDEX "idx_documents_project_live" ON "documents"("project_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_documents_doi" ON "documents"("doi");
CREATE INDEX "idx_documents_canonical_work" ON "documents"("canonical_work_id");

CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_versions_document_id_version_no_key" UNIQUE ("document_id", "version_no"),
    CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_document_versions_active" ON "document_versions"("document_id") WHERE "retired_at" IS NULL;

CREATE TABLE "document_extractions" (
    "id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "extractor_version" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "produced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_document_extractions_idempotency" UNIQUE ("document_version_id", "extractor_version", "content_hash"),
    CONSTRAINT "document_extractions_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "document_blocks" (
    "id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "type" "document_block_type" NOT NULL,
    "page" INTEGER NOT NULL,
    "bbox" JSONB,
    "text" TEXT NOT NULL,
    "parent_block_id" UUID,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "document_blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_blocks_document_version_id_ordinal_key" UNIQUE ("document_version_id", "ordinal"),
    CONSTRAINT "document_blocks_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_blocks_parent_block_id_fkey" FOREIGN KEY ("parent_block_id") REFERENCES "document_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_document_blocks_type" ON "document_blocks"("document_version_id", "type");

CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "char_span" JSONB NOT NULL,
    "token_count" INTEGER NOT NULL,
    "page" INTEGER,
    "section" TEXT,
    "block_ids" UUID[] NOT NULL,
    "content_hash" TEXT NOT NULL,
    "chunker_version" TEXT NOT NULL,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chunks_document_version_id_chunker_version_content_hash_key" UNIQUE ("document_version_id", "chunker_version", "content_hash"),
    CONSTRAINT "chunks_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_chunks_version_ordinal" ON "chunks"("document_version_id", "ordinal");
CREATE INDEX "idx_chunks_project" ON "chunks"("project_id");
