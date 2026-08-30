/** Locked v1 embedding policy (GAP-EMBED-01). Sole sanctioned provider/model constants. */
export const EMBED_MODEL_ID = 'voyage-4' as const;
export const EMBED_MODEL_VERSION = 'embedding_v1' as const;
export const EMBED_DIMENSION = 1024 as const;
export const VOYAGE_EMBED_MAX_TEXTS = 1000;
export const VOYAGE_EMBED_MAX_TOKENS = 320_000;

export type EmbedInputType = 'query' | 'document';
