import { createHash } from 'node:crypto';
import { canonicalJson } from '../platform/queues/canonical-json';

export function fingerprintRetrievalQuery(input: {
  readonly query: string;
  readonly projectId: string;
  readonly k: number;
  readonly overFetchFactor: number;
  readonly efSearch: number;
  readonly includeUnresolved: boolean;
  readonly embeddingModel: string;
  readonly embeddingVersion: string;
}): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}
