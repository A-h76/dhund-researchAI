import { DomainError } from '../../src/platform/errors/domain-error';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  REFRESH_COOKIE_NAME,
  serializeCsrfCookie,
  serializeRefreshCookie,
} from '../../src/platform/http/auth-cookies';
import { csrfExpressMiddleware } from '../../src/platform/http/csrf.middleware';

function run(
  req: { method?: string; headers: Record<string, unknown> },
): Error | undefined {
  let captured: Error | undefined;
  csrfExpressMiddleware(req, {}, (error?: unknown) => {
    if (error instanceof Error) {
      captured = error;
    }
  });
  return captured;
}

describe('CSRF middleware', () => {
  const refresh = serializeRefreshCookie('family.secret').split(';')[0];
  const csrf = serializeCsrfCookie('csrf-token').split(';')[0];
  const cookie = `${refresh}; ${csrf}`;

  it('skips safe methods and requests without a refresh cookie', () => {
    expect(run({ method: 'GET', headers: { cookie } })).toBeUndefined();
    expect(run({ method: 'POST', headers: {} })).toBeUndefined();
  });

  it('skips Bearer-authenticated mutations even when cookies are present', () => {
    expect(
      run({
        method: 'POST',
        headers: {
          cookie,
          authorization: 'Bearer access-token',
        },
      }),
    ).toBeUndefined();
  });

  it('requires a matching CSRF header for cookie-authenticated mutations', () => {
    const missing = run({ method: 'POST', headers: { cookie } });
    expect(missing).toBeInstanceOf(DomainError);
    expect(missing).toMatchObject({ code: ErrorCode.CsrfInvalid });

    const mismatch = run({
      method: 'POST',
      headers: { cookie, [CSRF_HEADER_NAME]: 'other' },
    });
    expect(mismatch).toMatchObject({ code: ErrorCode.CsrfInvalid });

    expect(
      run({
        method: 'POST',
        headers: { cookie, [CSRF_HEADER_NAME]: 'csrf-token' },
      }),
    ).toBeUndefined();
  });

  it('names the cookies used in the double-submit pair', () => {
    expect(REFRESH_COOKIE_NAME).toBe('dhund_refresh');
    expect(CSRF_COOKIE_NAME).toBe('dhund_csrf');
  });
});
