import { createRequire } from 'node:module';
import { Injectable } from '@nestjs/common';
import { MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER } from './extract.constants';
import type { PdfPageText, PdfParseResult, PdfParser } from './pdf-parser.port';

const requirePdf = createRequire(__filename);
type PdfParseCtor = {
  new (options: { data: Buffer | Uint8Array }): {
    getText: () => Promise<{
      text: string;
      total: number;
      pages: Array<{ num: number; text: string }>;
    }>;
    destroy: () => Promise<void>;
  };
  setWorker?: (workerSrc?: string) => string;
};
const pdfParseModule = requirePdf('pdf-parse') as { PDFParse: PdfParseCtor };

// Resolve pdf.js worker for Node/Jest (no-op when PDFParse is mocked in unit tests).
if (typeof pdfParseModule.PDFParse?.setWorker === 'function') {
  pdfParseModule.PDFParse.setWorker(
    requirePdf.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  );
}

/**
 * Sole PDF parse path in the system (DHB-50 single-owner).
 * Do not add a second PDF parser elsewhere — static tests enforce this.
 */
@Injectable()
export class PdfParseAdapter implements PdfParser {
  async parse(buffer: Buffer): Promise<PdfParseResult> {
    const parser = new pdfParseModule.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const pageCount = Math.max(1, result.total || result.pages.length || 1);
      const pages: PdfPageText[] =
        result.pages.length > 0
          ? result.pages.map((page) => ({
              pageNumber: page.num,
              text: stripPdfParseArtifacts(page.text),
            }))
          : [{ pageNumber: 1, text: stripPdfParseArtifacts(result.text ?? '') }];
      while (pages.length < pageCount) {
        pages.push({ pageNumber: pages.length + 1, text: '' });
      }
      return toParseResult(pages.map((page) => page.text).join('\f'), pageCount);
    } finally {
      await parser.destroy();
    }
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

function stripPdfParseArtifacts(text: string): string {
  return text
    .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
