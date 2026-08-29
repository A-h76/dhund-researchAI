-- DHB-30 / Phase 2 §4.7 migration 010: embeddings (GAP-EMBED-01 / GAP-HNSW-01)

CREATE TABLE "chunk_embeddings" (
    "id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "model_id" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" vector(1024) NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" "embedding_status" NOT NULL,

    CONSTRAINT "chunk_embeddings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chunk_embeddings_chunk_id_model_version_content_hash_key" UNIQUE ("chunk_id", "model_version", "content_hash"),
    CONSTRAINT "chk_chunk_embeddings_dimensions" CHECK ("dimensions" = 1024),
    CONSTRAINT "chk_chunk_embeddings_v1_model" CHECK ("model_version" <> 'embedding_v1' OR "model_id" = 'voyage-4'),
    CONSTRAINT "chunk_embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_chunk_embeddings_hnsw_embedding_v1" ON "chunk_embeddings"
    USING hnsw ("vector" vector_cosine_ops)
    WITH (m = 16, ef_construction = 128)
    WHERE "model_version" = 'embedding_v1' AND "status" = 'ok';

CREATE INDEX "idx_chunk_embeddings_project" ON "chunk_embeddings"("project_id", "model_version")
    WHERE "status" = 'ok';
