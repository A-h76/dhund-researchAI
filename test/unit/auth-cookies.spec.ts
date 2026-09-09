import {
  CSRF_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  serializeCsrfCookie,
  serializeRefreshCookie,
} from '../../src/platform/http/auth-cookies';

describe('auth cookies', () => {
  it('serializes refresh as HttpOnly and CSRF as readable', () => {
    const refresh = serializeRefreshCookie('family.secret');
    const csrf = serializeCsrfCookie('csrf-value');
    expect(refresh.startsWith(`${REFRESH_COOKIE_NAME}=family.secret`)).toBe(true);
    expect(refresh).toContain('Path=/v1/auth');
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('Secure');
    expect(refresh).toContain('SameSite=Lax');
    expect(csrf.startsWith(`${CSRF_COOKIE_NAME}=csrf-value`)).toBe(true);
    expect(csrf).toContain('Path=/');
    expect(csrf).toContain('Secure');
    expect(csrf).toContain('SameSite=Lax');
    expect(csrf).not.toContain('HttpOnly');
  });
});
