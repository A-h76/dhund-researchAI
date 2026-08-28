import {
  generateObjectKey,
  sanitizeFilename,
} from '../../src/l0/adapters/s3-compatible/object-key.util';

describe('generateObjectKey', () => {
  it('builds server-side keys with fixed segment order', () => {
    expect(generateObjectKey('org1', 'proj1', 'docs', 'doc1', 'report.pdf')).toBe(
      'org1/proj1/docs/doc1/report.pdf',
    );
  });

  it('ignores adversarial path traversal in filename', () => {
    const key = generateObjectKey('org1', 'proj1', 'docs', 'doc1', '../../etc/passwd');
    expect(key).toBe('org1/proj1/docs/doc1/passwd');
    expect(key).not.toContain('..');
  });

  it('strips null bytes and unsafe characters from filename', () => {
    const key = generateObjectKey('org1', 'proj1', 'docs', 'doc1', 'evil\0name?.txt');
    expect(key).toBe('org1/proj1/docs/doc1/evilname_.txt');
  });

  it('sanitizes traversal segments in ids', () => {
    const key = generateObjectKey('org/1', '../proj', 'cat', 'id:1', 'file.txt');
    expect(key).toBe('org_1/___proj/cat/id_1/file.txt');
  });
});

describe('sanitizeFilename', () => {
  it('uses basename only', () => {
    expect(sanitizeFilename('/tmp/nested/evil.txt')).toBe('evil.txt');
  });

  it('falls back to file when filename is only unsafe characters', () => {
    expect(sanitizeFilename('???')).toBe('file');
  });
});
