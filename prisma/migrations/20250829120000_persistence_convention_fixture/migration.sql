-- DHB-28 convention fixture table (not a product domain model).
-- Establishes UUID PK (app-generated), TIMESTAMPTZ timestamps, jsonb, integer micros.

CREATE TABLE "_persistence_convention_fixture" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "metadata" JSONB NOT NULL,
    "cost_micros" BIGINT NOT NULL,

    CONSTRAINT "_persistence_convention_fixture_pkey" PRIMARY KEY ("id")
);
