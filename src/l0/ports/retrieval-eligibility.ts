import { HNSW_WRITE_ACTIVE_MODEL_VERSION } from './hnsw.constants';

/**
 * Join-evaluated retrieval eligibility (DHB-55). Shared by ANN and FTS so
 * ineligible rows never reach RRF. Not a post-fusion filter.
 *
 * Rights: a body chunk is ineligible when the document has a rights snapshot
 * that does not grant capabilities.body. User-uploaded docs (no snapshot)
 * remain eligible. Retained ineligible rows are not deleted.
 */
export const RETRIEVAL_ELIGIBILITY_SQL = `
d.deleted_at IS NULL
  AND dv.retired_at IS NULL
  AND d.status = 'completed'
  AND ce.status = 'ok'
  AND ce.model_version = '${HNSW_WRITE_ACTIVE_MODEL_VERSION}'
  AND NOT (
    (
      cardinality(c.block_ids) = 0
      OR EXISTS (
        SELECT 1
        FROM document_blocks b
        WHERE b.id = ANY (c.block_ids)
          AND b.type <> 'reference'::document_block_type
      )
    )
    AND d.rights_snapshot_id IS NOT NULL
    AND (rs.capabilities->>'body') IS DISTINCT FROM 'true'
  )
`.trim();
