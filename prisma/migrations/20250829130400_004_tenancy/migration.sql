-- DHB-29 / Phase 2 §2 migration 004: tenancy (GAP-ORG-OWNER-01)

CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "kind" "org_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_org_personal_owner" CHECK (
        ("kind" = 'PERSONAL' AND "owner_user_id" IS NOT NULL)
        OR ("kind" = 'TEAM' AND "owner_user_id" IS NULL)
    ),
    CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_org_personal_owner" ON "organizations"("owner_user_id")
    WHERE "kind" = 'PERSONAL' AND "deleted_at" IS NULL;

CREATE TABLE "org_memberships" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "org_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "org_memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_org_membership_active" ON "org_memberships"("org_id", "user_id")
    WHERE "revoked_at" IS NULL;
CREATE INDEX "idx_org_memberships_user" ON "org_memberships"("user_id") WHERE "revoked_at" IS NULL;

CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_projects_org_live" ON "projects"("org_id") WHERE "deleted_at" IS NULL;

CREATE TABLE "project_memberships" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "project_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_memberships_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_project_membership_active" ON "project_memberships"("project_id", "user_id")
    WHERE "revoked_at" IS NULL;
CREATE INDEX "idx_project_memberships_user" ON "project_memberships"("user_id") WHERE "revoked_at" IS NULL;
