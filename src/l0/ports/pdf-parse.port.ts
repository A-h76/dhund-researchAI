export interface PdfBbox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface PdfTextItem {
  readonly text: string;
  readonly bbox: PdfBbox;
  readonly fontHeight: number;
}

export interface PdfParsedPage {
  readonly page: number;
  readonly width: number;
  readonly height: number;
  readonly items: readonly PdfTextItem[];
}

export type PdfParseResult =
  | { readonly kind: 'text'; readonly pages: readonly PdfParsedPage[] }
  | { readonly kind: 'needs_ocr'; readonly pageCount: number }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface PdfParseService {
  parse(bytes: Buffer): Promise<PdfParseResult>;
}
