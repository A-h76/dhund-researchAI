import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import { resolveHnswEfSearch } from '../../ports/hnsw-ef-search';
import {
  RetrievalArmUnavailableError,
  type FtsHit,
  type FtsSearchInput,
  type RetrievalIndexStore,
} from '../../ports/retrieval-index.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

/**
 * GAP-FTS-01: lexical queries hit `chunks.search_vector` so they use
 * `idx_chunks_fts` (DHB-31). project_id is in WHERE before @@.
 */
export const FTS_SEARCH_SQL = `
SELECT c.id AS "chunkId", c.project_id AS "projectId", dv.document_id AS "documentId"
FROM chunks c
JOIN document_versions dv ON dv.id = c.document_version_id
JOIN documents d ON d.id = dv.document_id AND d.deleted_at IS NULL
WHERE c.project_id = $1::uuid
  AND c.search_vector @@ plainto_tsquery('english', $2)
ORDER BY ts_rank(c.search_vector, plainto_tsquery('english', $2)) DESC
LIMIT $3
`.trim();

@Injectable()
export class PrismaRetrievalIndexAdapter implements RetrievalIndexStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async ftsSearch(input: FtsSearchInput): Promise<readonly FtsHit[]> {
    await this.database.connect();
    try {
      return await this.client().$queryRawUnsafe<FtsHit[]>(
        FTS_SEARCH_SQL,
        input.scope.projectId,
        input.query,
        input.limit,
      );
    } catch (error) {
      throw new RetrievalArmUnavailableError('fts', new L0OperationError('FTS search failed', error));
    }
  }

  async readHnswEfSearch(efSearch: number): Promise<number> {
    const resolved = resolveHnswEfSearch(efSearch);
    await this.database.connect();
    try {
      const rows = await this.client().$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${String(resolved)}`);
        return tx.$queryRaw<Array<{ value: string }>>`
          SELECT current_setting('hnsw.ef_search') AS value
        `;
      });
      return Number(rows[0]?.value);
    } catch (error) {
      throw new RetrievalArmUnavailableError(
        'vector',
        new L0OperationError('HNSW ef_search probe failed', error),
      );
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}
