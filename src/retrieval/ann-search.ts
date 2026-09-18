import { Inject, Injectable } from '@nestjs/common';
import {
  EmbeddingDimensionMismatchError,
  InvalidHnswEfSearchError,
  RetrievalArmUnavailableError,
  SCOPED_STORE,
  resolveHnswEfSearch,
  type AnnHit,
  type ProjectScope,
  type ScopedStore,
} from '../l0/ports';
import { APP_CONFIG, type FrozenAppConfig } from '../platform/config';
import { RetrievalMetrics } from './retrieval.metrics';

export interface AnnSearchResult {
  readonly hits: readonly AnnHit[];
  readonly efSearch: number;
}

@Injectable()
export class AnnSearch {
  constructor(
    @Inject(SCOPED_STORE) private readonly store: ScopedStore,
    @Inject(APP_CONFIG) private readonly config: FrozenAppConfig,
    private readonly metrics: RetrievalMetrics,
  ) {}

  async nearest(
    scope: ProjectScope,
    vector: string,
    limit: number,
    efSearch?: number,
  ): Promise<AnnSearchResult> {
    const resolved = resolveHnswEfSearch(efSearch ?? this.config.hnswEfSearch);
    try {
      const hits = await this.store.annNearest(scope, vector, limit, { efSearch: resolved });
      this.metrics.recordVectorQuery({ hitCount: hits.length, efSearch: resolved });
      return { hits, efSearch: resolved };
    } catch (error) {
      if (
        error instanceof EmbeddingDimensionMismatchError ||
        error instanceof InvalidHnswEfSearchError
      ) {
        throw error;
      }
      this.metrics.recordArmUnavailable('vector');
      throw new RetrievalArmUnavailableError('vector', error);
    }
  }
}
