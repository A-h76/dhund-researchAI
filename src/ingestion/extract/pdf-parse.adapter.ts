import { createRequire } from 'node:module';
import { Injectable } from '@nestjs/common';
import { MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER } from './extract.constants';
import type { PdfPageText, PdfParseResult, PdfParser } from './pdf-parser.port';

const requirePdf = createRequire(__filename);
const pdfParse = requirePdf('pdf-parse') as (
  buffer: Buffer,
) => Promise<{ text?: string; numpages?: number }>;

/**
 * Sole PDF parse path in the system (DHB-50 single-owner).
 * Do not add a second PDF parser elsewhere — static tests enforce this.
 */
@Injectable()
export class PdfParseAdapter implements PdfParser {
  async parse(buffer: Buffer): Promise<PdfParseResult> {
    const parsed = await pdfParse(buffer);
    return toParseResult(parsed.text ?? '', Math.max(1, parsed.numpages || 1));
  }
}

/** Pure helper — unit-tested without loading pdf.js under Jest. */
export function toParseResult(rawText: string, pageCount: number): PdfParseResult {
  const pages = splitPages(rawText, pageCount);
  const fullText = pages.map((page) => page.text).join('\n').trim();
  const avgChars = fullText.length / pageCount;
  const hasExtractableTextLayer =
    fullText.length > 0 && avgChars >= MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER;

  return {
    pageCount,
    pages,
    fullText,
    hasExtractableTextLayer,
  };
}

function splitPages(rawText: string, pageCount: number): PdfPageText[] {
  const segments = rawText.includes('\f') ? rawText.split('\f') : [rawText];
  const pages: PdfPageText[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    pages.push({
      pageNumber: index + 1,
      text: (segments[index] ?? '').trim(),
    });
  }
  return pages;
}
