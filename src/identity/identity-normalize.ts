import { createHash } from 'node:crypto';

/** Stable author fingerprint for canonical_works.author_hash. */
export function hashAuthors(authors: readonly string[]): string {
  const normalized = authors
    .map((author) => author.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((author) => author.length > 0)
    .sort()
    .join('|');
  return createHash('sha256').update(normalized).digest('hex');
}

export function normalizePmid(raw: string): string | null {
  const digits = raw.trim().replace(/^pmid:/i, '');
  if (!/^\d{1,16}$/.test(digits)) {
    return null;
  }
  return digits;
}

export function normalizeArxivIdentifier(raw: string): string | null {
  const id = raw
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/v\d+$/i, '');
  if (id.length === 0) {
    return null;
  }
  return id.toLowerCase();
}
