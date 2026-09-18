/** Target chunk size (~400 tokens → ~40–120 chunks per typical paper). */
export const TARGET_CHUNK_TOKENS = 400;

/** Hard ceiling — a single chunk never exceeds this. */
export const MAX_CHUNK_TOKENS = 500;

/** Deterministic token estimate: ~4 characters per token. */
export const CHARS_PER_TOKEN = 4;

/**
 * Embedding model version stamped onto embed jobs enqueued by chunk. Must equal
 * the locked AI policy version (GAP-EMBED-01) — the embed job refuses any
 * version that is not write-active. Ingestion cannot import from the AI layer,
 * so the equality is asserted by test instead of shared by reference.
 */
export const EMBED_MODEL_VERSION = 'embedding_v1';
