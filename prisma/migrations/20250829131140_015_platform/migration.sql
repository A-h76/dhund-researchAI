-- DHB-31 / Phase 2 §11 migration 015: outbox + audit_events

CREATE OR REPLACE FUNCTION "trg_audit_events_append_only"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'DELETE rejected: append-only table audit_events';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD."id" IS DISTINCT FROM NEW."id"
            OR OLD."actor_type" IS DISTINCT FROM NEW."actor_type"
            OR OLD."action" IS DISTINCT FROM NEW."action"
            OR OLD."scope" IS DISTINCT FROM NEW."scope"
            OR OLD."before_ref" IS DISTINCT FROM NEW."before_ref"
            OR OLD."after_ref" IS DISTINCT FROM NEW."after_ref"
            OR OLD."correlation_id" IS DISTINCT FROM NEW."correlation_id"
            OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
        THEN
            RAISE EXCEPTION 'UPDATE rejected: append-only table audit_events';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relayed_at" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_outbox_schema_version" CHECK ("schema_version" >= 1)
);

CREATE INDEX "idx_outbox_unrelayed" ON "outbox"("created_at") WHERE "relayed_at" IS NULL;
CREATE INDEX "idx_outbox_aggregate" ON "outbox"("aggregate_type", "aggregate_id", "created_at");

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "before_ref" TEXT,
    "after_ref" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_audit_scope_project" ON "audit_events"((("scope"->>'projectId')), "created_at" DESC);
CREATE INDEX "idx_audit_actor" ON "audit_events"("actor_id", "created_at" DESC) WHERE "actor_id" IS NOT NULL;
CREATE INDEX "idx_audit_action" ON "audit_events"("action", "created_at" DESC);

CREATE TRIGGER "trg_audit_events_append_only"
    BEFORE UPDATE OR DELETE ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION "trg_audit_events_append_only"();
