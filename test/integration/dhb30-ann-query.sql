-- Project-scoped ANN query used by DHB-30 integration test.
-- project_id filter appears in WHERE before the ANN distance operator.
SELECT ce.project_id, ce.chunk_id
FROM chunk_embeddings ce
WHERE ce.project_id = $1::uuid
  AND ce.model_version = 'embedding_v1'
  AND ce.status = 'ok'
ORDER BY ce.vector <=> $2::vector(1024)
LIMIT 5;
