export const EXTRACTOR_VERSION = 'extract-v1';
export const CHUNKER_VERSION = 'chunk-v1';

/** Minimum average characters per page to treat a PDF as having an extractable text layer. */
export const MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER = 20;

export type ExtractionStatus = 'ok' | 'failed' | 'needs_ocr';

export const EXTRACTION_STATUS = {
  Ok: 'ok',
  Failed: 'failed',
  NeedsOcr: 'needs_ocr',
} as const satisfies Record<string, ExtractionStatus>;
