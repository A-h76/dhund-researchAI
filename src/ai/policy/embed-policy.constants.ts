/** Locked v1 embedding policy (GAP-EMBED-01). Sole sanctioned provider/model constants. */
export const EMBED_MODEL_ID = 'voyage-4' as const;
export const EMBED_MODEL_VERSION = 'embedding_v1' as const;
export const EMBED_DIMENSION = 1024 as const;
export const VOYAGE_EMBED_MAX_TEXTS = 1000;
export const VOYAGE_EMBED_MAX_TOKENS = 320_000;

export type EmbedInputType = 'query' | 'document';

/** Stored chunks embed as documents; retrieval embeds queries. The split is never mixed. */
export const EMBED_DOCUMENT_INPUT_TYPE: EmbedInputType = 'document';
export const EMBED_QUERY_INPUT_TYPE: EmbedInputType = 'query';

/**
 * Exactly one embedding version is write-active. The embed job refuses any
 * other version; embed-backfill is the only path permitted to target one.
 */
export const WRITE_ACTIVE_EMBED_MODEL_VERSION: string = EMBED_MODEL_VERSION;

export function isWriteActiveEmbedModelVersion(modelVersion: string): boolean {
  return modelVersion === WRITE_ACTIVE_EMBED_MODEL_VERSION;
}
