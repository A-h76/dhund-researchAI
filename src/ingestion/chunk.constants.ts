/** Target chunk size (~400 tokens → ~40–120 chunks per typical paper). */
export const TARGET_CHUNK_TOKENS = 400;

/** Hard ceiling — a single chunk never exceeds this. */
export const MAX_CHUNK_TOKENS = 500;

/** Deterministic token estimate: ~4 characters per token. */
export const CHARS_PER_TOKEN = 4;

/** Embedding model version stamped onto embed jobs enqueued by chunk. */
export const EMBED_MODEL_VERSION = 'v1';
