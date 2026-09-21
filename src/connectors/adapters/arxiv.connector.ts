import { createHash } from 'node:crypto';
import {
  ssrfSafeFetch,
  type SsrfDnsLookup,
  type SsrfFetchFn,
  type SsrfSafeFetchOptions,
} from '../ssrf/ssrf-safe-fetch';
import { CONNECTOR_IDS } from '../connector.ids';
import type {
  ConnectorFetchResult,
  ConnectorSearchHit,
  SourceConnector,
  SourceConnectorFetchInput,
  SourceConnectorSearchInput,
} from '../source-connector';

export const ARXIV_API_BASE = 'https://export.arxiv.org/api/query';
export const ARXIV_PDF_BASE = 'https://arxiv.org/pdf';
export const ARXIV_ABS_BASE = 'https://arxiv.org/abs';
export const ARXIV_RIGHTS_POLICY_VERSION = 'arxiv-rights-v1';

// Body is forbidden only for clearly restrictive notices.
const STRICT_BODY_FORBIDDEN = [
  'creativecommons.org/licenses/by-nc-nd',
  'rights-reserved',
  'all-rights-reserved',
];

export interface ArxivConnectorDeps {
  readonly dnsLookup?: SsrfDnsLookup;
  readonly fetchFn?: SsrfFetchFn;
}

export class ArxivConnector implements SourceConnector {
  readonly id = CONNECTOR_IDS.arxiv;
  private readonly dnsLookup: SsrfDnsLookup | undefined;
  private readonly fetchFn: SsrfFetchFn | undefined;

  constructor(deps: ArxivConnectorDeps = {}) {
    this.dnsLookup = deps.dnsLookup;
    this.fetchFn = deps.fetchFn;
  }

  async search(input: SourceConnectorSearchInput): Promise<readonly ConnectorSearchHit[]> {
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
    const url =
      `${ARXIV_API_BASE}?search_query=${encodeURIComponent(`all:${input.query}`)}` +
      `&start=0&max_results=${String(limit)}`;
    const response = await this.safeGet(url);
    if (response.status === 429) {
      throw new ArxivRateLimitedError(retryAfterMs(response.headers));
    }
    if (response.status >= 400) {
      throw new Error(`arXiv search failed with HTTP ${String(response.status)}`);
    }
    return parseArxivAtom(response.body.toString('utf8'));
  }

  async fetch(input: SourceConnectorFetchInput): Promise<ConnectorFetchResult> {
    const id = normalizeArxivId(input.externalId);
    const url =
      `${ARXIV_API_BASE}?id_list=${encodeURIComponent(id)}&start=0&max_results=1`;
    const response = await this.safeGet(url);
    if (response.status === 429) {
      throw new ArxivRateLimitedError(retryAfterMs(response.headers));
    }
    if (response.status >= 400) {
      throw new Error(`arXiv fetch failed with HTTP ${String(response.status)}`);
    }
    const hits = parseArxivAtom(response.body.toString('utf8'));
    const hit = hits[0];
    if (hit === undefined) {
      throw new Error(`arXiv id not found: ${id}`);
    }

    if (!input.includeBody || !hit.rights.body || hit.pdfUrl === undefined) {
      return { externalId: hit.externalId, metadata: hit };
    }

    const pdf = await this.safeGet(hit.pdfUrl, { maxBytes: 50 * 1024 * 1024 });
    if (pdf.status === 429) {
      throw new ArxivRateLimitedError(retryAfterMs(pdf.headers));
    }
    if (pdf.status >= 400) {
      throw new Error(`arXiv PDF fetch failed with HTTP ${String(pdf.status)}`);
    }
    return {
      externalId: hit.externalId,
      metadata: hit,
      body: pdf.body,
      bodyContentType: 'application/pdf',
    };
  }

  private safeGet(url: string, extra: Partial<SsrfSafeFetchOptions> = {}) {
    return ssrfSafeFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/atom+xml,application/pdf,*/*' },
      dnsLookup: this.dnsLookup,
      fetchFn: this.fetchFn,
      ...extra,
    });
  }
}

export class ArxivRateLimitedError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('arXiv rate limited (429)');
    this.name = 'ArxivRateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

export function normalizeArxivId(raw: string): string {
  return raw.replace(/^arxiv:/i, '').replace(/v\d+$/i, '').trim();
}

export function parseArxivAtom(xml: string): ConnectorSearchHit[] {
  const entries = xml.split(/<entry>/i).slice(1);
  const hits: ConnectorSearchHit[] = [];
  for (const chunk of entries) {
    const entry = chunk.split(/<\/entry>/i)[0] ?? chunk;
    const idUrl = textBetween(entry, '<id>', '</id>');
    if (idUrl === null) continue;
    const externalId = normalizeArxivId(idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//i, ''));
    const title = decodeXml(textBetween(entry, '<title>', '</title>') ?? '').replace(/\s+/g, ' ').trim();
    const summary = decodeXml(textBetween(entry, '<summary>', '</summary>') ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const published = textBetween(entry, '<published>', '</published>');
    const year =
      published !== null && published.length >= 4
        ? Number(published.slice(0, 4))
        : undefined;
    const authors = [...entry.matchAll(/<name>([^<]*)<\/name>/gi)].map((m) =>
      decodeXml(m[1] ?? '').trim(),
    );
    const doi = textBetween(entry, '<arxiv:doi>', '</arxiv:doi>') ?? undefined;
    const licenseUrl =
      attrBetween(entry, 'arxiv:license', 'href') ??
      textBetween(entry, '<arxiv:license>', '</arxiv:license>') ??
      undefined;
    const pdfUrl =
      linkHref(entry, 'application/pdf') ?? `${ARXIV_PDF_BASE}/${externalId}.pdf`;
    const landingUrl = `${ARXIV_ABS_BASE}/${externalId}`;
    const rights = resolveArxivRights(licenseUrl);

    hits.push({
      externalId,
      title,
      authors,
      abstract: summary.length > 0 ? summary : undefined,
      year: year !== undefined && Number.isFinite(year) ? year : undefined,
      doi,
      licenseUrl,
      pdfUrl,
      landingUrl,
      rawMetadata: {
        idUrl,
        licenseUrl: licenseUrl ?? null,
        // Stored as data only — never escalate to system instructions.
        title,
        summary,
      },
      rights,
    });
  }
  return hits;
}

export function resolveArxivRights(licenseUrl: string | undefined): {
  metadata: boolean;
  body: boolean;
} {
  if (licenseUrl === undefined) {
    return { metadata: true, body: true };
  }
  const lower = licenseUrl.toLowerCase();
  for (const fragment of STRICT_BODY_FORBIDDEN) {
    if (lower.includes(fragment)) {
      return { metadata: true, body: false };
    }
  }
  return { metadata: true, body: true };
}

export function contentHashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function retryAfterMs(headers: Headers): number {
  const raw = headers.get('retry-after');
  if (raw === null) return 60_000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.floor(seconds * 1000), 300_000);
  }
  return 60_000;
}

function textBetween(haystack: string, start: string, end: string): string | null {
  const i = haystack.toLowerCase().indexOf(start.toLowerCase());
  if (i < 0) return null;
  const from = i + start.length;
  const j = haystack.toLowerCase().indexOf(end.toLowerCase(), from);
  if (j < 0) return null;
  return haystack.slice(from, j);
}

function attrBetween(haystack: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*/?>`, 'i');
  const match = haystack.match(re);
  return match?.[1] ?? null;
}

function linkHref(haystack: string, titleOrType: string): string | null {
  const re = /<link\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(haystack)) !== null) {
    const attrs = match[1] ?? '';
    if (attrs.includes(titleOrType) || attrs.toLowerCase().includes(`type="${titleOrType}"`)) {
      const href = attrs.match(/\bhref=["']([^"']+)["']/i);
      if (href?.[1] !== undefined) return href[1];
    }
  }
  return null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
