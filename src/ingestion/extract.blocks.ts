import type {
  ExtractBlockInput,
  ExtractBlockType,
  PdfBbox,
  PdfParsedPage,
  PdfTextItem,
} from '../l0/ports';

const LINE_Y_TOLERANCE = 0.4;

export function blocksFromPages(
  pages: readonly PdfParsedPage[],
  idFor: () => string,
): ExtractBlockInput[] {
  const blocks: ExtractBlockInput[] = [];
  let ordinal = 0;
  for (const page of pages) {
    const medianHeight = median(page.items.map((item) => item.fontHeight).filter((h) => h > 0));
    const lines = groupLines(page.items);
    for (const line of lines) {
      const text = line.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
      if (text.length === 0) {
        continue;
      }
      const height =
        line.reduce((sum, item) => sum + item.fontHeight, 0) / Math.max(1, line.length);
      const type: ExtractBlockType = height > medianHeight * 1.35 ? 'heading' : 'paragraph';
      blocks.push({
        id: idFor(),
        type,
        page: page.page,
        bbox: unionBbox(line.map((item) => item.bbox)),
        text,
        ordinal,
      });
      ordinal += 1;
    }
  }
  return blocks;
}

function groupLines(items: readonly PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => {
    const yDelta = b.bbox.y0 - a.bbox.y0;
    if (Math.abs(yDelta) > 0.01) {
      return yDelta;
    }
    return a.bbox.x0 - b.bbox.x0;
  });
  const lines: PdfTextItem[][] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    if (current === undefined) {
      lines.push([item]);
      continue;
    }
    const sample = current[0];
    const tolerance = Math.max(sample.fontHeight, item.fontHeight, 1) * LINE_Y_TOLERANCE;
    if (Math.abs(sample.bbox.y0 - item.bbox.y0) <= tolerance) {
      current.push(item);
    } else {
      lines.push([item]);
    }
  }
  return lines;
}

function unionBbox(boxes: readonly PdfBbox[]): PdfBbox {
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 12;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 12) + (sorted[mid] ?? 12)) / 2;
  }
  return sorted[mid] ?? 12;
}
