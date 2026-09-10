-- DHB-57 durable retrieval provenance. Fingerprint and body live in Postgres.

CREATE TABLE "retrieval_traces" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "query_fingerprint" TEXT NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "embedding_version" TEXT NOT NULL,
    "k" INTEGER NOT NULL,
    "over_fetch_factor" INTEGER NOT NULL,
    "ef_search" INTEGER NOT NULL,
    "fallbacks_used" JSONB NOT NULL DEFAULT '[]',
    "body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieval_traces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "retrieval_traces_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_retrieval_traces_project_fingerprint" ON "retrieval_traces"("project_id", "query_fingerprint");
