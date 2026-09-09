import { createHash } from 'node:crypto';
import {
  HibpBreachListAdapter,
  rangeContainsSuffix,
} from '../../src/l0/adapters/hibp/hibp-breach-list.adapter';

describe('HIBP breach-list adapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends only the SHA-1 prefix and never the password', async () => {
    const password = 'passwordpassword';
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain(`/range/${prefix}`);
      expect(url).not.toContain(password);
      expect(url).not.toContain(sha1);
      return new Response(`${suffix}:12\nABCDEF0123:1\n`, { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new HibpBreachListAdapter();
    await expect(adapter.check(password)).resolves.toBe('breached');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns clear when the suffix is absent', async () => {
    global.fetch = jest.fn(async () => new Response('ABCDEF0123:1\n', { status: 200 })) as unknown as typeof fetch;
    const adapter = new HibpBreachListAdapter();
    await expect(adapter.check('unbreached-pass')).resolves.toBe('clear');
  });

  it('returns unavailable on a non-OK response', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    const adapter = new HibpBreachListAdapter();
    await expect(adapter.check('abcdefghijkl')).resolves.toBe('unavailable');
  });

  it('returns unavailable on timeout', async () => {
    global.fetch = jest.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
          });
        }),
    ) as unknown as typeof fetch;

    const adapter = new HibpBreachListAdapter();
    adapter.timeoutMs = 20;
    await expect(adapter.check('abcdefghijkl')).resolves.toBe('unavailable');
  });

  it('parses padded range rows by suffix only', () => {
    expect(rangeContainsSuffix('AABBCC:1\r\nDDEEFF:99\n', 'DDEEFF')).toBe(true);
    expect(rangeContainsSuffix('AABBCC:1\n', 'DDEEFF')).toBe(false);
  });
});
