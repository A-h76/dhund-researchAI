-- DHB-31 / Phase 2 §9b migration 019: library folders + items

CREATE TABLE "library_folders" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_folder_id" UUID,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "library_folders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "library_folders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "library_folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "library_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_library_folders_tree" ON "library_folders"("project_id", "parent_folder_id", "position") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_library_folders_live" ON "library_folders"("project_id", "parent_folder_id", "name") WHERE "deleted_at" IS NULL;

CREATE TABLE "library_items" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "folder_id" UUID,
    "document_id" UUID,
    "external_record_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "library_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_library_item_target" CHECK (
        ("document_id" IS NOT NULL AND "external_record_id" IS NULL)
        OR ("document_id" IS NULL AND "external_record_id" IS NOT NULL)
    ),
    CONSTRAINT "library_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "library_items_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "library_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "library_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "library_items_external_record_id_fkey" FOREIGN KEY ("external_record_id") REFERENCES "external_records"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_library_item_doc" ON "library_items"("project_id", "folder_id", "document_id")
    WHERE "document_id" IS NOT NULL AND "folder_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_library_item_record" ON "library_items"("project_id", "folder_id", "external_record_id")
    WHERE "external_record_id" IS NOT NULL AND "folder_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_library_item_doc_root" ON "library_items"("project_id", "document_id")
    WHERE "document_id" IS NOT NULL AND "folder_id" IS NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_library_item_record_root" ON "library_items"("project_id", "external_record_id")
    WHERE "external_record_id" IS NOT NULL AND "folder_id" IS NULL AND "deleted_at" IS NULL;
CREATE INDEX "idx_library_items_folder" ON "library_items"("project_id", "folder_id", "position") WHERE "deleted_at" IS NULL;
