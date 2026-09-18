import { estimateTokens } from '../../ingestion/chunk.blocks';
import {
  VOYAGE_EMBED_MAX_TEXTS,
  VOYAGE_EMBED_MAX_TOKENS,
} from '../policy/embed-policy.constants';

export interface EmbeddableText {
  readonly text: string;
}

/**
 * Packs items into requests that stay inside the Voyage caps: at most
 * VOYAGE_EMBED_MAX_TEXTS texts and VOYAGE_EMBED_MAX_TOKENS estimated tokens per
 * request. An item that alone exceeds the token cap is emitted on its own so
 * the caller sees the provider's refusal rather than losing the text here.
 */
export function planEmbedBatches<T extends EmbeddableText>(
  items: readonly T[],
): readonly (readonly T[])[] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;

  for (const item of items) {
    const tokens = estimateTokens(item.text);
    const wouldOverflow =
      current.length >= VOYAGE_EMBED_MAX_TEXTS ||
      (current.length > 0 && currentTokens + tokens > VOYAGE_EMBED_MAX_TOKENS);

    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(item);
    currentTokens += tokens;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

/** Groups by project so every gateway call carries a single project context. */
export function groupByProject<T extends { readonly projectId: string }>(
  items: readonly T[],
): readonly (readonly T[])[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.projectId);
    if (group === undefined) {
      groups.set(item.projectId, [item]);
    } else {
      group.push(item);
    }
  }
  return [...groups.values()];
}
