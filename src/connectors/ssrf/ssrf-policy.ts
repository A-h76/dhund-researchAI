import { isIP } from 'node:net';
import { DomainError, ErrorCode } from '../../platform/errors';

const MODULE = 'connectors.ssrf';

/** Schemes permitted for connector egress. */
export const SSRF_ALLOWED_SCHEMES = new Set(['http:', 'https:']);

const BLOCKED_LITERAL_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
]);

export function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  // IPv4-mapped IPv6
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1] !== undefined) {
    return isBlockedIpv4(mapped[1]);
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

export function assertUrlSchemeAllowed(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DomainError(ErrorCode.UrlSchemeNotAllowed, { module: MODULE });
  }
  if (!SSRF_ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new DomainError(ErrorCode.UrlSchemeNotAllowed, { module: MODULE });
  }
  return parsed;
}

export function assertHostnameNotLiterallyBlocked(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_LITERAL_HOSTS.has(host)) {
    throw new DomainError(ErrorCode.UrlTargetBlocked, { module: MODULE });
  }
  // Literal IP in hostname
  if (isIP(host) !== 0 && isBlockedIp(host)) {
    throw new DomainError(ErrorCode.UrlTargetBlocked, { module: MODULE });
  }
}

export function assertResolvedAddressesAllowed(addresses: readonly string[]): void {
  if (addresses.length === 0) {
    throw new DomainError(ErrorCode.UrlTargetBlocked, { module: MODULE });
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new DomainError(ErrorCode.UrlTargetBlocked, { module: MODULE });
    }
  }
}
