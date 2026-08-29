-- DHB-31 / Phase 2 migration 016: FTS lexical arm (GAP-FTS-01)
-- chunks.text is the single lexical projection (written once by DHB-52 chunk job).
-- search_vector is generated from chunks.text so it cannot drift from the lexical source.
-- document trigram indexes assist identity lookup only (never merge decisions).
-- Do NOT modify migration 009 or 010.

ALTER TABLE "chunks" ADD COLUMN "text" TEXT NOT NULL DEFAULT '';
ALTER TABLE "chunks" ALTER COLUMN "text" DROP DEFAULT;

ALTER TABLE "chunks" ADD COLUMN "search_vector" tsvector
    GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;

CREATE INDEX "idx_chunks_fts" ON "chunks" USING GIN ("search_vector");

CREATE INDEX "idx_documents_title_trgm" ON "documents" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "idx_documents_authors_trgm" ON "documents" USING GIN (array_to_string("authors", ' ') gin_trgm_ops);
