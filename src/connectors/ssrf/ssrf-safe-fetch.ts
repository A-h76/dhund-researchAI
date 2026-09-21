import { lookup as dnsLookup } from 'node:dns/promises';
import { DomainError, ErrorCode } from '../../platform/errors';
import {
  assertHostnameNotLiterallyBlocked,
  assertResolvedAddressesAllowed,
  assertUrlSchemeAllowed,
} from './ssrf-policy';

const MODULE = 'connectors.ssrf';
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export type SsrfDnsLookup = (hostname: string) => Promise<readonly string[]>;
export type SsrfFetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface SsrfSafeFetchOptions {
  readonly method?: 'GET' | 'HEAD';
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  readonly maxBytes?: number;
  /** Injected for tests — defaults to dns.promises.lookup all. */
  readonly dnsLookup?: SsrfDnsLookup;
  /** Injected for tests — defaults to global fetch with redirect:manual. */
  readonly fetchFn?: SsrfFetchFn;
}

export interface SsrfSafeFetchResult {
  readonly url: string;
  readonly status: number;
  readonly headers: Headers;
  readonly body: Buffer;
}

async function defaultDnsLookup(hostname: string): Promise<readonly string[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

/**
 * SSRF-safe HTTP GET/HEAD for connectors.
 * Validates scheme, hostname, DNS-resolved IPs, and re-validates every redirect hop.
 */
export async function ssrfSafeFetch(
  rawUrl: string,
  options: SsrfSafeFetchOptions = {},
): Promise<SsrfSafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lookup = options.dnsLookup ?? defaultDnsLookup;
  const fetchFn = options.fetchFn ?? defaultManualFetch;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = assertUrlSchemeAllowed(current);
    assertHostnameNotLiterallyBlocked(parsed.hostname);
    const addresses = await lookup(parsed.hostname);
    assertResolvedAddressesAllowed(addresses);

    const response = await fetchFn(current, {
      method: options.method ?? 'GET',
      headers: options.headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location');
      if (location === null || location.length === 0) {
        throw new DomainError(ErrorCode.UrlTargetBlocked, { module: MODULE });
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (options.method === 'HEAD') {
      return {
        url: current,
        status: response.status,
        headers: response.headers,
        body: Buffer.alloc(0),
      };
    }

    const body = await readBodyCapped(response, maxBytes);
    return {
      url: current,
      status: response.status,
      headers: response.headers,
      body,
    };
  }

  throw new DomainError(ErrorCode.UrlTargetBlocked, {
    module: MODULE,
    userMessage: 'Too many redirects',
  });
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function defaultManualFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new DomainError(ErrorCode.ResponseTooLarge, { module: MODULE });
    }
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DomainError(ErrorCode.ResponseTooLarge, { module: MODULE });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
