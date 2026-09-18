import { Inject, Injectable } from '@nestjs/common';
import {
  RETRIEVAL_INDEX,
  RetrievalArmUnavailableError,
  type FtsHit,
  type ProjectScope,
  type RetrievalIndexStore,
} from '../l0/ports';
import { RetrievalMetrics } from './retrieval.metrics';

@Injectable()
export class LexicalSearch {
  constructor(
    @Inject(RETRIEVAL_INDEX) private readonly store: RetrievalIndexStore,
    private readonly metrics: RetrievalMetrics,
  ) {}

  async search(
    scope: ProjectScope,
    query: string,
    limit: number,
  ): Promise<readonly FtsHit[]> {
    try {
      const hits = await this.store.ftsSearch({ scope, query, limit });
      this.metrics.recordFtsQuery(hits.length);
      return hits;
    } catch (error) {
      this.metrics.recordArmUnavailable('fts');
      if (error instanceof RetrievalArmUnavailableError) {
        throw error;
      }
      throw new RetrievalArmUnavailableError('fts', error);
    }
  }
}
