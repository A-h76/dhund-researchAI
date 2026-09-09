import type { PdfParseResult, PdfParseService, PdfParsedPage } from '../../src/l0/ports/pdf-parse.port';

export class MemoryPdfParser implements PdfParseService {
  result: PdfParseResult = { kind: 'invalid', reason: 'unset' };

  async parse(_bytes: Buffer): Promise<PdfParseResult> {
    return this.result;
  }
}

export function textPage(page: number, text: string, fontHeight = 12): PdfParsedPage {
  return {
    page,
    width: 612,
    height: 792,
    items: [
      {
        text,
        fontHeight,
        bbox: { x0: 72, y0: 700, x1: 400, y1: 700 + fontHeight },
      },
    ],
  };
}
