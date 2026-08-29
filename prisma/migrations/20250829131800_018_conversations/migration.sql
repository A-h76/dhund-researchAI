-- DHB-31 / Phase 2 §9a migration 018: conversations + messages + evidence bindings

CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_conversations_project_updated" ON "conversations"("project_id", "updated_at" DESC) WHERE "deleted_at" IS NULL;

CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "message_role" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "message_status" NOT NULL DEFAULT 'pending',
    "sequence" INTEGER NOT NULL,
    "ai_execution_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_conversation_id_sequence_key" UNIQUE ("conversation_id", "sequence"),
    CONSTRAINT "chk_message_assistant_provenance" CHECK (
        "role" <> 'assistant'::"message_role"
        OR "status" <> 'complete'::"message_status"
        OR "ai_execution_id" IS NOT NULL
    ),
    CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_messages_conversation" ON "messages"("conversation_id", "sequence");

CREATE TABLE "message_evidence_bindings" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_evidence_bindings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_evidence_bindings_message_id_evidence_id_key" UNIQUE ("message_id", "evidence_id"),
    CONSTRAINT "message_evidence_bindings_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "message_evidence_bindings_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_meb_evidence" ON "message_evidence_bindings"("evidence_id");
CREATE INDEX "idx_meb_project" ON "message_evidence_bindings"("project_id");
