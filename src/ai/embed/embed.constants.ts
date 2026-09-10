/**
 * Chunks resolved per backfill page. Small enough that a global cap of two
 * concurrent backfills cannot monopolise the batch lane, large enough that a
 * page still fills a Voyage request.
 */
export const EMBED_BACKFILL_PAGE_SIZE = 500;
