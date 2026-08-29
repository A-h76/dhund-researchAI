-- DHB-30 / Phase 2 §10.1–10.5 migration 007: global identity (no tenant column on canonical_works)

CREATE TABLE "canonical_works" (
    "id" UUID NOT NULL,
    "canonical_title" TEXT NOT NULL,
    "author_hash" TEXT NOT NULL,
    "year" INTEGER,
    "type" "canonical_work_type" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_works_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_canonical_works_identity" ON "canonical_works"("author_hash", "year");
CREATE INDEX "idx_canonical_works_title_trgm" ON "canonical_works" USING GIN ("canonical_title" gin_trgm_ops);

CREATE TABLE "work_manifestations" (
    "id" UUID NOT NULL,
    "canonical_work_id" UUID NOT NULL,
    "manifestation_type" TEXT NOT NULL,
    "bibliographic_metadata" JSONB NOT NULL,
    "preferred_source_connector_id" TEXT,

    CONSTRAINT "work_manifestations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_manifestations_canonical_work_id_fkey" FOREIGN KEY ("canonical_work_id") REFERENCES "canonical_works"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_work_manifestations_canonical_work" ON "work_manifestations"("canonical_work_id");

CREATE TABLE "external_identifiers" (
    "id" UUID NOT NULL,
    "canonical_work_id" UUID NOT NULL,
    "scheme" "identifier_scheme" NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "external_identifiers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "external_identifiers_scheme_value_key" UNIQUE ("scheme", "value"),
    CONSTRAINT "external_identifiers_canonical_work_id_fkey" FOREIGN KEY ("canonical_work_id") REFERENCES "canonical_works"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_external_identifiers_canonical_work" ON "external_identifiers"("canonical_work_id");

CREATE TABLE "work_relationships" (
    "id" UUID NOT NULL,
    "from_work_id" UUID NOT NULL,
    "to_work_id" UUID NOT NULL,
    "type" "work_relationship_type" NOT NULL,
    "provenance" JSONB NOT NULL,

    CONSTRAINT "work_relationships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_relationships_from_to_type_key" UNIQUE ("from_work_id", "to_work_id", "type"),
    CONSTRAINT "work_relationships_from_work_id_fkey" FOREIGN KEY ("from_work_id") REFERENCES "canonical_works"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "work_relationships_to_work_id_fkey" FOREIGN KEY ("to_work_id") REFERENCES "canonical_works"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_work_rel_to" ON "work_relationships"("to_work_id", "type");

CREATE TABLE "merge_candidates" (
    "id" UUID NOT NULL,
    "candidate_work_id" UUID NOT NULL,
    "existing_work_id" UUID NOT NULL,
    "match_type" "merge_match_type" NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "merge_status" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "merge_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "merge_candidates_candidate_work_id_fkey" FOREIGN KEY ("candidate_work_id") REFERENCES "canonical_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "merge_candidates_existing_work_id_fkey" FOREIGN KEY ("existing_work_id") REFERENCES "canonical_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "merge_candidates_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_merge_candidates_pending_pair" ON "merge_candidates"("candidate_work_id", "existing_work_id")
    WHERE "status" = 'pending';
CREATE INDEX "idx_merge_candidates_pending" ON "merge_candidates"("status") WHERE "status" = 'pending';
