export interface PdfPageText {
  readonly pageNumber: number;
  readonly text: string;
}

export interface PdfParseResult {
  readonly pageCount: number;
  readonly pages: readonly PdfPageText[];
  readonly fullText: string;
  readonly hasExtractableTextLayer: boolean;
}

export interface PdfParser {
  parse(buffer: Buffer): Promise<PdfParseResult>;
}

export const PDF_PARSER = Symbol('PDF_PARSER');
