-- DHB-62: link CHAT ai_executions to the RetrievalTrace that grounded them.
ALTER TABLE "ai_executions"
    ADD COLUMN "retrieval_trace_id" UUID;

ALTER TABLE "ai_executions"
    ADD CONSTRAINT "ai_executions_retrieval_trace_id_fkey"
    FOREIGN KEY ("retrieval_trace_id") REFERENCES "retrieval_traces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_ai_executions_retrieval_trace"
    ON "ai_executions"("retrieval_trace_id")
    WHERE "retrieval_trace_id" IS NOT NULL;
