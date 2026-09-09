export const REFRESH_COOKIE_NAME = 'dhund_refresh';
export const CSRF_COOKIE_NAME = 'dhund_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export const REFRESH_COOKIE_PATH = '/v1/auth';
export const CSRF_COOKIE_PATH = '/';

export interface HeaderAppendResponse {
  append(field: string, value: string): unknown;
}

export function attachAuthCookies(
  res: HeaderAppendResponse,
  refreshToken: string,
  csrfToken: string,
): void {
  res.append('Set-Cookie', serializeRefreshCookie(refreshToken));
  res.append('Set-Cookie', serializeCsrfCookie(csrfToken));
}

export function clearAuthCookies(res: HeaderAppendResponse): void {
  res.append('Set-Cookie', serializeRefreshCookie('', 0));
  res.append('Set-Cookie', serializeCsrfCookie('', 0));
}

export function serializeRefreshCookie(value: string, maxAge?: number): string {
  return serializeCookie(REFRESH_COOKIE_NAME, value, {
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge,
  });
}

export function serializeCsrfCookie(value: string, maxAge?: number): string {
  return serializeCookie(CSRF_COOKIE_NAME, value, {
    path: CSRF_COOKIE_PATH,
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
    maxAge,
  });
}

export function parseCookieHeader(
  header: string | readonly string[] | undefined,
): Record<string, string> {
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (typeof raw !== 'string' || raw.length === 0) {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name.length === 0) {
      continue;
    }
    cookies[name] = value;
  }
  return cookies;
}

export function readRefreshCookie(
  header: string | readonly string[] | undefined,
): string | undefined {
  const value = parseCookieHeader(header)[REFRESH_COOKIE_NAME];
  return value === undefined || value.length === 0 ? undefined : value;
}

export function readCsrfCookie(
  header: string | readonly string[] | undefined,
): string | undefined {
  const value = parseCookieHeader(header)[CSRF_COOKIE_NAME];
  return value === undefined || value.length === 0 ? undefined : value;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Lax';
    maxAge?: number;
  },
): string {
  const parts = [`${name}=${value}`, `Path=${options.path}`, `SameSite=${options.sameSite}`];
  if (options.secure) {
    parts.push('Secure');
  }
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  return parts.join('; ');
}
