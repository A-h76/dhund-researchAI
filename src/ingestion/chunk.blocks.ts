import { createHash } from 'node:crypto';
import type { ChunkCharSpan } from '../l0/ports/chunk-store.port';
import type { StoredBlock } from '../l0/ports/extract-store.port';
import {
  CHARS_PER_TOKEN,
  MAX_CHUNK_TOKENS,
  TARGET_CHUNK_TOKENS,
} from './chunk.constants';

/**
 * Lexical projection invariant (DHB-52): document_blocks is the authoritative
 * extraction source. A chunk's text is a derived, immutable projection that is
 * reconstructed from its block_ids + char_span. The chunk contentHash covers
 * the derived text. There is no edit path for chunk text — if blocks and the
 * projection disagree, the chunk is stale and blocks win.
 */

const BLOCK_JOINER = '\n';

export interface BuiltChunk {
  readonly id: string;
  readonly ordinal: number;
  readonly blockIds: readonly string[];
  readonly charSpan: ChunkCharSpan;
  readonly text: string;
  readonly tokenCount: number;
  readonly page: number | null;
  readonly contentHash: string;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Reconstruct a chunk's text from authoritative blocks. Blocks are looked up
 * by the chunk's blockIds (in stored order), joined, then sliced by charSpan.
 * Returns null when a referenced block no longer exists.
 */
export function reconstructChunkText(
  blocksById: ReadonlyMap<string, StoredBlock>,
  blockIds: readonly string[],
  charSpan: ChunkCharSpan,
): string | null {
  const texts: string[] = [];
  for (const blockId of blockIds) {
    const block = blocksById.get(blockId);
    if (block === undefined) {
      return null;
    }
    texts.push(block.text);
  }
  return texts.join(BLOCK_JOINER).slice(charSpan.start, charSpan.end);
}

/** A chunk is stale when its stored text no longer matches the block projection. */
export function isChunkStale(
  chunk: {
    readonly blockIds: readonly string[];
    readonly charSpan: ChunkCharSpan;
    readonly text: string;
  },
  blocks: readonly StoredBlock[],
): boolean {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const reconstructed = reconstructChunkText(blocksById, chunk.blockIds, chunk.charSpan);
  return reconstructed !== chunk.text;
}

/**
 * Pack ordered blocks into ~TARGET_CHUNK_TOKENS chunks. Whole blocks are
 * packed together; a single oversized block is split at whitespace boundaries
 * into windows referencing that block via charSpan. Never reads the PDF.
 */
export function buildChunksFromBlocks(
  blocks: readonly StoredBlock[],
  generateId: () => string,
): readonly BuiltChunk[] {
  const ordered = [...blocks].sort((a, b) => a.ordinal - b.ordinal);
  const chunks: BuiltChunk[] = [];
  let group: StoredBlock[] = [];
  let groupTokens = 0;

  const flushGroup = (): void => {
    if (group.length === 0) {
      return;
    }
    const text = group.map((block) => block.text).join(BLOCK_JOINER);
    chunks.push(
      makeChunk(generateId, chunks.length, group.map((block) => block.id), {
        start: 0,
        end: text.length,
      }, text, group[0]?.page ?? null),
    );
    group = [];
    groupTokens = 0;
  };

  for (const block of ordered) {
    const blockTokens = estimateTokens(block.text);

    if (blockTokens > MAX_CHUNK_TOKENS) {
      flushGroup();
      for (const span of splitOversizedBlock(block.text)) {
        const text = block.text.slice(span.start, span.end);
        chunks.push(
          makeChunk(generateId, chunks.length, [block.id], span, text, block.page),
        );
      }
      continue;
    }

    if (group.length > 0 && groupTokens + blockTokens > TARGET_CHUNK_TOKENS) {
      flushGroup();
    }
    group.push(block);
    groupTokens += blockTokens;
  }
  flushGroup();

  return chunks;
}

function makeChunk(
  generateId: () => string,
  ordinal: number,
  blockIds: readonly string[],
  charSpan: ChunkCharSpan,
  text: string,
  page: number | null,
): BuiltChunk {
  return {
    id: generateId(),
    ordinal,
    blockIds,
    charSpan,
    text,
    tokenCount: estimateTokens(text),
    page,
    contentHash: chunkContentHash(text),
  };
}

function splitOversizedBlock(text: string): readonly ChunkCharSpan[] {
  const targetChars = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN;
  const spans: ChunkCharSpan[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + targetChars, text.length);
    if (end < text.length) {
      const lastBreak = text.lastIndexOf(' ', end);
      if (lastBreak > start) {
        end = lastBreak;
      }
    }
    spans.push({ start, end });
    start = end === start ? end + targetChars : end;
  }
  return spans;
}
