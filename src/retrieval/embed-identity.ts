import { HNSW_WRITE_ACTIVE_MODEL_VERSION } from '../l0/ports';

/**
 * Layer-local copies of the write-active embed identity. Retrieval cannot
 * import ai/; callers and static tests assert these stay equal to the AI policy.
 */
export const RETRIEVAL_EMBED_MODEL_ID = 'voyage-4' as const;
export const RETRIEVAL_EMBED_MODEL_VERSION = HNSW_WRITE_ACTIVE_MODEL_VERSION;
