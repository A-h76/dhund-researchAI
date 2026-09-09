import type { ExtractBlockInput } from '../l0/ports';

export interface OcrBlockSource {
  readonly page: number;
  readonly blocks: readonly {
    readonly text: string;
    readonly bbox?: {
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
    } | null;
  }[];
}

export function blocksFromOcrPages(
  pages: readonly OcrBlockSource[],
  idFor: () => string,
): ExtractBlockInput[] {
  const blocks: ExtractBlockInput[] = [];
  let ordinal = 0;
  for (const page of pages) {
    for (const block of page.blocks) {
      const text = block.text.replace(/\s+/g, ' ').trim();
      if (text.length === 0) {
        continue;
      }
      blocks.push({
        id: idFor(),
        type: 'paragraph',
        page: page.page,
        bbox: block.bbox ?? null,
        text,
        ordinal,
      });
      ordinal += 1;
    }
  }
  return blocks;
}
