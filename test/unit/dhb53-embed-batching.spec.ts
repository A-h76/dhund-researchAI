import {
  VOYAGE_EMBED_MAX_TEXTS,
  VOYAGE_EMBED_MAX_TOKENS,
} from '../../src/ai/policy/embed-policy.constants';
import { estimateTokens } from '../../src/ingestion/chunk.blocks';
import { groupByProject, planEmbedBatches } from '../../src/ai/embed/embed.blocks';

function tokensIn(batch: readonly { text: string }[]): number {
  return batch.reduce((total, item) => total + estimateTokens(item.text), 0);
}

describe('DHB-53 embed batching', () => {
  it('never exceeds the Voyage text cap', () => {
    const items = Array.from({ length: VOYAGE_EMBED_MAX_TEXTS * 2 + 7 }, () => ({
      text: 'short',
    }));

    const batches = planEmbedBatches(items);

    expect(batches).toHaveLength(3);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(VOYAGE_EMBED_MAX_TEXTS);
    }
    expect(batches.flat()).toHaveLength(items.length);
  });

  it('never exceeds the Voyage token cap for a multi-item batch', () => {
    // Each item is a tenth of the token budget, so eleven cannot share a request.
    const text = 'x'.repeat((VOYAGE_EMBED_MAX_TOKENS / 10) * 4);
    const items = Array.from({ length: 11 }, () => ({ text }));

    const batches = planEmbedBatches(items);

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(tokensIn(batch)).toBeLessThanOrEqual(VOYAGE_EMBED_MAX_TOKENS);
    }
    expect(batches.flat()).toHaveLength(items.length);
  });

  it('emits an over-budget single item alone rather than dropping it', () => {
    const oversized = { text: 'x'.repeat(VOYAGE_EMBED_MAX_TOKENS * 8) };

    const batches = planEmbedBatches([{ text: 'small' }, oversized, { text: 'small' }]);

    expect(batches.some((batch) => batch.length === 1 && batch[0] === oversized)).toBe(true);
    expect(batches.flat()).toHaveLength(3);
  });

  it('returns no batches for no items', () => {
    expect(planEmbedBatches([])).toEqual([]);
  });

  it('groups by project so a request never spans two project contexts', () => {
    const groups = groupByProject([
      { projectId: 'p1', text: 'a' },
      { projectId: 'p2', text: 'b' },
      { projectId: 'p1', text: 'c' },
    ]);

    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(new Set(group.map((item) => item.projectId)).size).toBe(1);
    }
  });
});
