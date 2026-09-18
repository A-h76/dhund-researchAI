import type { EvidenceLookupResult, EvidenceLookupRow } from '../l0/ports';
import type { QualityAnnotation, RankedCandidate, SearchCandidate } from './retrieval.port';

export function mapEvidence(
  hits: readonly RankedCandidate[],
  lookup: EvidenceLookupResult,
): SearchCandidate[] {
  const byChunk = new Map<string, EvidenceLookupRow[]>();
  for (const row of lookup.evidence) {
    const bucket = byChunk.get(row.chunkId);
    if (bucket === undefined) {
      byChunk.set(row.chunkId, [row]);
      continue;
    }
    bucket.push(row);
  }
  const sourceByDocument = new Map<string, string>();
  for (const source of lookup.sources) {
    sourceByDocument.set(source.documentId, source.id);
  }

  return hits.map((hit) => {
    const rows = byChunk.get(hit.chunkId) ?? [];
    const sourceId = rows[0]?.sourceId ?? sourceByDocument.get(hit.documentId) ?? hit.documentId;
    return {
      ...hit,
      sourceId,
      evidenceRefs: rows.map((row) => row.id),
      qualityAnnotation: annotationFor(rows),
    };
  });
}

function annotationFor(rows: readonly EvidenceLookupRow[]): QualityAnnotation {
  if (rows.some((row) => row.type === 'body_grounded') || rows.length === 0) {
    return 'body_grounded';
  }
  return 'metadata_only';
}
