import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PdfjsParseAdapter } from '../../src/l0/adapters/pdfjs/pdfjs-parse.adapter';

const OCR_FIXTURES = join(__dirname, '..', 'fixtures', 'ocr');

describe('DHB-51 SPYTM OCR fixtures', () => {
  const parser = new PdfjsParseAdapter();

  it('routes the scanned fixture to OCR rather than empty successful text', async () => {
    const bytes = readFileSync(join(OCR_FIXTURES, 'spytm_Scanned.pdf'));
    const result = await parser.parse(bytes);
    expect(result.kind).toBe('needs_ocr');
  });

  it('keeps text-layer and hybrid fixtures as parseable documents, not executed instructions', async () => {
    const ocrPdf = await parser.parse(readFileSync(join(OCR_FIXTURES, 'spytm_OCR.pdf')));
    const hybrid = await parser.parse(
      readFileSync(join(OCR_FIXTURES, 'spytm_Hybrid_Scan_OCR.pdf')),
    );
    expect(['text', 'needs_ocr']).toContain(ocrPdf.kind);
    expect(['text', 'needs_ocr']).toContain(hybrid.kind);
    if (ocrPdf.kind === 'text') {
      const text = ocrPdf.pages.flatMap((page) => page.items.map((item) => item.text)).join(' ');
      expect(text.length).toBeGreaterThan(0);
    }
    if (hybrid.kind === 'text') {
      const text = hybrid.pages.flatMap((page) => page.items.map((item) => item.text)).join(' ');
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
