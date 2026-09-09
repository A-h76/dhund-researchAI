import { createRequire } from 'node:module';
import { Injectable } from '@nestjs/common';
import type { PdfParseResult, PdfParseService, PdfParsedPage, PdfTextItem } from '../../ports/pdf-parse.port';

const nodeRequire = createRequire(__filename);

export const MIN_EXTRACTABLE_CHARS = 1;

interface PdfjsTextItem {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
}

interface PdfjsDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<{
    getViewport(input: { scale: number }): { width: number; height: number };
    getTextContent(): Promise<{ items: ReadonlyArray<PdfjsTextItem | Record<string, unknown>> }>;
  }>;
  destroy(): Promise<void>;
}

interface PdfjsLegacy {
  getDocument(params: {
    data: Uint8Array;
    isEvalSupported: boolean;
    isOffscreenCanvasSupported: boolean;
    useSystemFonts: boolean;
    stopAtErrors: boolean;
  }): { promise: Promise<PdfjsDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

let pdfjs: PdfjsLegacy | undefined;

function loadPdfjs(): PdfjsLegacy {
  if (pdfjs === undefined) {
    // CJS require so Nest's commonjs build and Jest can load pdfjs-dist 3 (UMD).
    pdfjs = nodeRequire('pdfjs-dist/legacy/build/pdf.js') as PdfjsLegacy;
    pdfjs.GlobalWorkerOptions.workerSrc = nodeRequire.resolve(
      'pdfjs-dist/legacy/build/pdf.worker.js',
    );
  }
  return pdfjs;
}

@Injectable()
export class PdfjsParseAdapter implements PdfParseService {
  async parse(bytes: Buffer): Promise<PdfParseResult> {
    if (bytes.byteLength < 5 || bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
      return { kind: 'invalid', reason: 'not_pdf' };
    }

    try {
      const task = loadPdfjs().getDocument({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        isOffscreenCanvasSupported: false,
        useSystemFonts: true,
        stopAtErrors: false,
      });
      const document = await task.promise;
      const pages: PdfParsedPage[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items: PdfTextItem[] = [];
        for (const item of content.items) {
          if (!isPdfjsTextItem(item) || item.str.length === 0) {
            continue;
          }
          const transform = item.transform;
          const x0 = transform[4] ?? 0;
          const y0 = transform[5] ?? 0;
          const fontHeight = Math.abs(transform[3] || item.height || 0);
          items.push({
            text: item.str,
            fontHeight,
            bbox: {
              x0,
              y0,
              x1: x0 + item.width,
              y1: y0 + fontHeight,
            },
          });
        }
        pages.push({
          page: pageNumber,
          width: viewport.width,
          height: viewport.height,
          items,
        });
      }
      await document.destroy();

      if (pages.length === 0) {
        return { kind: 'invalid', reason: 'empty_document' };
      }

      const letters = countExtractableChars(pages.flatMap((page) => page.items));
      if (letters < MIN_EXTRACTABLE_CHARS) {
        return { kind: 'needs_ocr', pageCount: pages.length };
      }
      return { kind: 'text', pages };
    } catch {
      return { kind: 'invalid', reason: 'parse_failed' };
    }
  }
}

function isPdfjsTextItem(item: PdfjsTextItem | Record<string, unknown>): item is PdfjsTextItem {
  return (
    'str' in item &&
    typeof item.str === 'string' &&
    Array.isArray(item.transform) &&
    typeof item.width === 'number' &&
    typeof item.height === 'number'
  );
}

function countExtractableChars(items: readonly PdfTextItem[]): number {
  let count = 0;
  for (const item of items) {
    for (const char of item.text) {
      if (/[A-Za-z0-9]/.test(char)) {
        count += 1;
      }
    }
  }
  return count;
}
