import { DomainError, ErrorCode } from '../../src/platform/errors';
import {
  assertHostnameNotLiterallyBlocked,
  assertResolvedAddressesAllowed,
  assertUrlSchemeAllowed,
  isBlockedIp,
} from '../../src/connectors/ssrf/ssrf-policy';
import { ssrfSafeFetch } from '../../src/connectors/ssrf/ssrf-safe-fetch';

describe('DHB-70 SSRF protection (§7.8)', () => {
  it('blocks file:// scheme', () => {
    expect(() => assertUrlSchemeAllowed('file:///etc/passwd')).toThrow(DomainError);
    try {
      assertUrlSchemeAllowed('file:///etc/passwd');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(ErrorCode.UrlSchemeNotAllowed);
    }
  });

  it('blocks loopback hostname and 169.254.169.254 metadata endpoint', () => {
    expect(() => assertHostnameNotLiterallyBlocked('localhost')).toThrow(DomainError);
    expect(() => assertHostnameNotLiterallyBlocked('127.0.0.1')).toThrow(DomainError);
    expect(() => assertHostnameNotLiterallyBlocked('169.254.169.254')).toThrow(DomainError);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('10.0.0.5')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });

  it('blocks when DNS resolves to a private address', () => {
    expect(() => assertResolvedAddressesAllowed(['10.1.2.3'])).toThrow(DomainError);
    expect(() => assertResolvedAddressesAllowed(['8.8.8.8'])).not.toThrow();
  });

  it('re-validates every redirect hop (public → private blocked at redirect)', async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string): Promise<Response> => {
      urls.push(url);
      if (url === 'https://public.example/start') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      return new Response('should-not-reach', { status: 200 });
    };

    const dnsLookup = async (hostname: string): Promise<readonly string[]> => {
      if (hostname === 'public.example') return ['93.184.216.34'];
      if (hostname === '169.254.169.254') return ['169.254.169.254'];
      return ['1.1.1.1'];
    };

    await expect(
      ssrfSafeFetch('https://public.example/start', { fetchFn, dnsLookup }),
    ).rejects.toMatchObject({ code: ErrorCode.UrlTargetBlocked });

    expect(urls).toEqual(['https://public.example/start']);
  });

  it('allows a public host that stays public across redirects', async () => {
    const fetchFn = async (url: string): Promise<Response> => {
      if (url === 'https://public.example/start') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://cdn.example/final' },
        });
      }
      return new Response('ok-body', { status: 200 });
    };
    const dnsLookup = async (): Promise<readonly string[]> => ['93.184.216.34'];

    const result = await ssrfSafeFetch('https://public.example/start', {
      fetchFn,
      dnsLookup,
    });
    expect(result.status).toBe(200);
    expect(result.body.toString('utf8')).toBe('ok-body');
    expect(result.url).toBe('https://cdn.example/final');
  });
});
