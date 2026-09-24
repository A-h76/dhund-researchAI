export const SECURE_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

export interface HeaderSink {
  setHeader(name: string, value: string): void;
}

export function applySecureHeaders(response: HeaderSink): void {
  for (const [name, value] of Object.entries(SECURE_HEADERS)) {
    response.setHeader(name, value);
  }
}
