-- DHB-67: ResearchArtifact carries aiExecutionId; generation failure produces no row.

ALTER TABLE "research_artifacts"
  ADD COLUMN "ai_execution_id" UUID;

-- No legacy artifact may exist without an execution id (ticket: failure → no row).
DELETE FROM "research_artifacts" WHERE "ai_execution_id" IS NULL;

ALTER TABLE "research_artifacts"
  ALTER COLUMN "ai_execution_id" SET NOT NULL;

ALTER TABLE "research_artifacts"
  ADD CONSTRAINT "research_artifacts_ai_execution_id_fkey"
  FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_research_artifacts_ai_execution"
  ON "research_artifacts"("ai_execution_id");
