function buildPdf(contentStream: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(Buffer.byteLength(contentStream, 'latin1'))} >>\nstream\n${contentStream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${String(index + 1)} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${String(objects.length + 1)}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer << /Size ${String(objects.length + 1)} /Root 1 0 R >>\n`;
  body += `startxref\n${String(xrefPos)}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

export function textLayerPdf(text: string): Buffer {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  return buildPdf(`BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`);
}

export function scannedPdf(): Buffer {
  return buildPdf('');
}
