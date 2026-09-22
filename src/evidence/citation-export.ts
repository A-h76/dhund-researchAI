import type { CitationQuality, CitationRecord } from '../l0/ports/citation-projection.port';
import { DomainError, ErrorCode } from '../platform/errors';

export const EXPORT_FORMATS = ['csl', 'bibtex', 'ris'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface BibliographicIdentity {
  readonly title: string;
  readonly authors: readonly string[];
  readonly year: number | null;
  readonly doi: string | null;
  readonly grounding: CitationQuality;
}

export function parseExportFormat(value: unknown): ExportFormat {
  if (value === 'csl' || value === 'bibtex' || value === 'ris') {
    return value;
  }
  throw new DomainError(ErrorCode.ValidationError, {
    module: 'evidence',
    userMessage: 'Export format must be csl, bibtex, or ris.',
  });
}

export function identityFromCitation(row: CitationRecord): BibliographicIdentity {
  const record = asRecord(row.cslJson);
  return {
    title: readString(record, 'title') ?? '',
    authors: readAuthors(record),
    year: readYear(record),
    doi: readString(record, 'DOI') ?? readString(record, 'doi'),
    grounding: row.qualityAnnotation,
  };
}

export function exportBibliography(
  format: ExportFormat,
  rows: readonly BibliographicIdentity[],
): string {
  switch (format) {
    case 'csl':
      return JSON.stringify(rows.map(toCsl));
    case 'bibtex':
      return rows.map((row, index) => toBibtex(row, index + 1)).join('\n');
    case 'ris':
      return rows.map(toRis).join('');
    default: {
      const unexpected: never = format;
      throw new Error(`Unknown export format: ${String(unexpected)}`);
    }
  }
}

export function parseExport(
  format: ExportFormat,
  body: string,
): readonly BibliographicIdentity[] {
  switch (format) {
    case 'csl':
      return parseCsl(body);
    case 'bibtex':
      return parseBibtex(body);
    case 'ris':
      return parseRis(body);
    default: {
      const unexpected: never = format;
      throw new Error(`Unknown export format: ${String(unexpected)}`);
    }
  }
}

function toCsl(row: BibliographicIdentity): Record<string, unknown> {
  return {
    title: row.title,
    author: row.authors.map((name) => ({ literal: name })),
    ...(row.year === null ? {} : { issued: { 'date-parts': [[row.year]] } }),
    ...(row.doi === null ? {} : { DOI: row.doi }),
    qualityAnnotation: row.grounding,
  };
}

function toBibtex(row: BibliographicIdentity, index: number): string {
  const fields = [
    `  title = {${escapeBibtex(row.title)}}`,
    `  author = {${escapeBibtex(row.authors.join(' and '))}}`,
    ...(row.year === null ? [] : [`  year = {${row.year}}`]),
    ...(row.doi === null ? [] : [`  doi = {${escapeBibtex(row.doi)}}`]),
    `  qualityannotation = {${row.grounding}}`,
  ];
  return `@article{dhund${index},\n${fields.join(',\n')}\n}`;
}

function toRis(row: BibliographicIdentity): string {
  const lines = ['TY  - JOUR', `TI  - ${row.title}`];
  for (const author of row.authors) {
    lines.push(`AU  - ${author}`);
  }
  if (row.year !== null) {
    lines.push(`PY  - ${row.year}`);
  }
  if (row.doi !== null) {
    lines.push(`DO  - ${row.doi}`);
  }
  lines.push(`C8  - ${row.grounding}`, 'ER  - ', '');
  return `${lines.join('\n')}\n`;
}

function parseCsl(body: string): readonly BibliographicIdentity[] {
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) {
    throw new Error('CSL export must be an array');
  }
  return parsed.map((entry) => {
    const record = asRecord(entry);
    if (record === null) {
      throw new Error('Export is missing the grounding label');
    }
    const grounding = readGrounding(record.qualityAnnotation);
    return {
      title: readString(record, 'title') ?? '',
      authors: readAuthors(record),
      year: readYear(record),
      doi: readString(record, 'DOI') ?? readString(record, 'doi'),
      grounding,
    };
  });
}

function parseBibtex(body: string): readonly BibliographicIdentity[] {
  if (body.trim().length === 0) {
    return [];
  }
  const entries = body.split(/@article\{/i).slice(1);
  return entries.map((entry) => {
    const fields = bibtexFields(entry);
    const author = fields.get('author') ?? '';
    return {
      title: fields.get('title') ?? '',
      authors: author.length === 0 ? [] : author.split(' and '),
      year: fields.has('year') ? Number(fields.get('year')) : null,
      doi: fields.get('doi') ?? null,
      grounding: readGrounding(fields.get('qualityannotation')),
    };
  });
}

function parseRis(body: string): readonly BibliographicIdentity[] {
  if (body.trim().length === 0) {
    return [];
  }
  return body
    .split(/ER {2}- ?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const authors: string[] = [];
      let title = '';
      let year: number | null = null;
      let doi: string | null = null;
      let grounding: string | undefined;
      for (const line of block.split('\n')) {
        const tag = line.slice(0, 2);
        const value = line.slice(6);
        switch (tag) {
          case 'TI':
            title = value;
            break;
          case 'AU':
            authors.push(value);
            break;
          case 'PY':
            year = Number(value);
            break;
          case 'DO':
            doi = value;
            break;
          case 'C8':
            grounding = value;
            break;
          default:
            break;
        }
      }
      return {
        title,
        authors,
        year,
        doi,
        grounding: readGrounding(grounding),
      };
    });
}

function bibtexFields(entry: string): Map<string, string> {
  const fields = new Map<string, string>();
  const pattern = /(\w+)\s*=\s*\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(entry)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      fields.set(key.toLowerCase(), unescapeBibtex(value));
    }
  }
  return fields;
}

function escapeBibtex(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

function unescapeBibtex(value: string): string {
  return value.replace(/\\([{}\\])/g, '$1');
}

function readGrounding(value: unknown): CitationQuality {
  if (value === 'body_grounded' || value === 'metadata_only') {
    return value;
  }
  throw new Error('Export is missing the grounding label');
}

function readAuthors(record: Record<string, unknown> | null): readonly string[] {
  if (record === null || !Array.isArray(record.author)) {
    return [];
  }
  const names: string[] = [];
  for (const author of record.author) {
    if (typeof author !== 'object' || author === null) {
      continue;
    }
    const row = author as Record<string, unknown>;
    if (typeof row.literal === 'string') {
      names.push(row.literal);
      continue;
    }
    const family = typeof row.family === 'string' ? row.family : '';
    const given = typeof row.given === 'string' ? row.given : '';
    const name = `${given} ${family}`.trim();
    if (name.length > 0) {
      names.push(name);
    }
  }
  return names;
}

function readYear(record: Record<string, unknown> | null): number | null {
  if (record === null) {
    return null;
  }
  if (typeof record.year === 'number') {
    return record.year;
  }
  const issued = record.issued;
  if (typeof issued !== 'object' || issued === null) {
    return null;
  }
  const parts = (issued as Record<string, unknown>)['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) {
    return null;
  }
  const year = parts[0][0];
  return typeof year === 'number' ? year : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (record === null) {
    return null;
  }
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
