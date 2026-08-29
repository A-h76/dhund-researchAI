-- DHB-30 / Phase 2 §10.6–10.9 migration 008: rights + external records (R10 append-only snapshots)

CREATE OR REPLACE FUNCTION "trg_reject_update_append_only"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'UPDATE rejected: append-only table %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "rights_snapshots" (
    "id" UUID NOT NULL,
    "connector_id" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rights_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rights_snapshots_connector_id_policy_version_key" UNIQUE ("connector_id", "policy_version")
);

CREATE TRIGGER "trg_rights_snapshots_reject_update"
    BEFORE UPDATE ON "rights_snapshots"
    FOR EACH ROW EXECUTE FUNCTION "trg_reject_update_append_only"();

CREATE TABLE "external_records" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "connector_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "type" "external_record_type" NOT NULL,
    "linked_canonical_work_id" UUID,
    "rights_snapshot_id" UUID NOT NULL,
    "last_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "external_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "external_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_records_linked_canonical_work_id_fkey" FOREIGN KEY ("linked_canonical_work_id") REFERENCES "canonical_works"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "external_records_rights_snapshot_id_fkey" FOREIGN KEY ("rights_snapshot_id") REFERENCES "rights_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_external_records_live" ON "external_records"("project_id", "connector_id", "external_id")
    WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_external_records_project_live" ON "external_records"("project_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_external_records_stale" ON "external_records"("connector_id", "last_checked_at") WHERE "deleted_at" IS NULL;

CREATE TABLE "external_record_snapshots" (
    "id" UUID NOT NULL,
    "external_record_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "content_ref" TEXT,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "external_record_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "external_record_snapshots_external_record_id_fkey" FOREIGN KEY ("external_record_id") REFERENCES "external_records"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_ers_latest" ON "external_record_snapshots"("external_record_id", "captured_at" DESC);

CREATE TRIGGER "trg_external_record_snapshots_reject_update"
    BEFORE UPDATE ON "external_record_snapshots"
    FOR EACH ROW EXECUTE FUNCTION "trg_reject_update_append_only"();

CREATE TABLE "discovery_candidates" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "query_id" UUID NOT NULL,
    "connector_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "resolved_canonical_work_id" UUID,
    "status" "discovery_status" NOT NULL DEFAULT 'pending_admission',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "discovery_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discovery_candidates_project_query_connector_external_key" UNIQUE ("project_id", "query_id", "connector_id", "external_id"),
    CONSTRAINT "discovery_candidates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "discovery_candidates_resolved_canonical_work_id_fkey" FOREIGN KEY ("resolved_canonical_work_id") REFERENCES "canonical_works"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "idx_discovery_pending" ON "discovery_candidates"("project_id", "status") WHERE "status" = 'pending_admission';
