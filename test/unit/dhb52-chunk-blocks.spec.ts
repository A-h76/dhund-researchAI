import { createHash } from 'node:crypto';
import {
  buildChunksFromBlocks,
  chunkContentHash,
  estimateTokens,
  isChunkStale,
  reconstructChunkText,
} from '../../src/ingestion/chunk.blocks';
import {
  MAX_CHUNK_TOKENS,
  TARGET_CHUNK_TOKENS,
} from '../../src/ingestion/chunk.constants';
import type { StoredBlock } from '../../src/l0/ports/extract-store.port';
import { generateId } from '../../src/platform/ids/uuid-v7';

function block(ordinal: number, text: string, page = 1): StoredBlock {
  return {
    id: generateId(),
    documentVersionId: 'version-1',
    page,
    ordinal,
    text,
  };
}

function paperBlocks(paragraphs: number, charsPerParagraph = 700): StoredBlock[] {
  return Array.from({ length: paragraphs }, (_, index) =>
    block(
      index,
      `Paragraph ${index} ${'lorem ipsum dolor sit amet '.repeat(
        Math.ceil(charsPerParagraph / 27),
      )}`.slice(0, charsPerParagraph),
      Math.floor(index / 4) + 1,
    ),
  );
}

describe('DHB-52 chunk projection from blocks', () => {
  it('targets ~400 tokens per chunk and yields ~40-120 chunks for a typical paper', () => {
    // ~60 pages worth of paragraphs → typical paper scale.
    const blocks = paperBlocks(240);
    const chunks = buildChunksFromBlocks(blocks, generateId);

    expect(chunks.length).toBeGreaterThanOrEqual(40);
    expect(chunks.length).toBeLessThanOrEqual(120);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(MAX_CHUNK_TOKENS + TARGET_CHUNK_TOKENS);
    }
    const mean =
      chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / chunks.length;
    expect(mean).toBeGreaterThan(TARGET_CHUNK_TOKENS * 0.4);
    expect(mean).toBeLessThan(TARGET_CHUNK_TOKENS * 1.5);
  });

  it('carries block references and char spans so the text is reconstructable', () => {
    const blocks = paperBlocks(24);
    const blocksById = new Map(blocks.map((row) => [row.id, row]));
    const chunks = buildChunksFromBlocks(blocks, generateId);

    for (const chunk of chunks) {
      expect(chunk.blockIds.length).toBeGreaterThan(0);
      for (const blockId of chunk.blockIds) {
        expect(blocksById.has(blockId)).toBe(true);
      }
      const reconstructed = reconstructChunkText(
        blocksById,
        chunk.blockIds,
        chunk.charSpan,
      );
      expect(reconstructed).toBe(chunk.text);
    }
  });

  it('splits an oversized block into spans referencing the same block', () => {
    const bigText = 'word '.repeat(2000).trim(); // ~10,000 chars >> MAX
    const big = block(0, bigText);
    const chunks = buildChunksFromBlocks([big], generateId);

    expect(chunks.length).toBeGreaterThan(1);
    const blocksById = new Map([[big.id, big]]);
    for (const chunk of chunks) {
      expect(chunk.blockIds).toEqual([big.id]);
      expect(
        reconstructChunkText(blocksById, chunk.blockIds, chunk.charSpan),
      ).toBe(chunk.text);
    }
    // Spans jointly cover the whole block.
    const covered = chunks.reduce(
      (sum, chunk) => sum + (chunk.charSpan.end - chunk.charSpan.start),
      0,
    );
    expect(covered).toBe(bigText.length);
  });

  it('content-addresses each chunk by hashing the DERIVED chunk text', () => {
    const blocks = paperBlocks(8);
    const chunks = buildChunksFromBlocks(blocks, generateId);
    for (const chunk of chunks) {
      expect(chunk.contentHash).toBe(
        createHash('sha256').update(chunk.text, 'utf8').digest('hex'),
      );
      expect(chunk.contentHash).toBe(chunkContentHash(chunk.text));
    }
    // Identical content → identical hashes regardless of generated ids.
    const again = buildChunksFromBlocks(blocks, generateId);
    expect(again.map((chunk) => chunk.contentHash)).toEqual(
      chunks.map((chunk) => chunk.contentHash),
    );
  });

  it('detects a stale chunk when blocks disagree with the stored projection', () => {
    const blocks = paperBlocks(6);
    const chunks = buildChunksFromBlocks(blocks, generateId);
    const fresh = chunks[0]!;
    expect(isChunkStale(fresh, blocks)).toBe(false);

    // Blocks are authoritative: edit a referenced block → the chunk is stale.
    const mutated = blocks.map((row) =>
      row.id === fresh.blockIds[0] ? { ...row, text: `${row.text} EDITED` } : row,
    );
    expect(isChunkStale(fresh, mutated)).toBe(true);

    // Missing referenced block → stale as well.
    const missing = blocks.filter((row) => row.id !== fresh.blockIds[0]);
    expect(isChunkStale(fresh, missing)).toBe(true);
  });

  it('estimates tokens deterministically at ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(1600))).toBe(400);
  });
});
