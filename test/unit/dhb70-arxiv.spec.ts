import {
  parseArxivAtom,
  resolveArxivRights,
  normalizeArxivId,
  ArxivConnector,
} from '../../src/connectors/adapters/arxiv.connector';
import { ConnectorRateLimitedJobError } from '../../src/connectors/connector-job.errors';
import { ConnectorFetchService } from '../../src/connectors/connector-fetch.service';
import { ConnectorCircuitBreakerRegistry } from '../../src/connectors/connector-circuit-breaker';
import { ConnectorRateLimiter } from '../../src/connectors/connector-rate-limiter';
import { SourceConnectorRegistry } from '../../src/connectors/connector.registry';
import { ConnectorMetrics } from '../../src/connectors/connector.metrics';
import type { ConnectorCacheStore } from '../../src/l0/ports/connector-cache.port';
import { ConnectorCacheService } from '../../src/connectors/connector-cache.service';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

describe('DHB-70 arXiv connector + 429 backoff', () => {
  it('parses Atom entries into search hits', () => {
    const xml = `
      <feed xmlns:arxiv="http://arxiv.org/schemas/atom">
        <entry>
          <id>http://arxiv.org/abs/2301.00001v1</id>
          <title>A Sample Paper</title>
          <summary>Hello world</summary>
          <published>2023-01-01T00:00:00Z</published>
          <author><name>Ada Lovelace</name></author>
          <arxiv:doi>10.1234/example</arxiv:doi>
          <link href="https://arxiv.org/pdf/2301.00001.pdf" type="application/pdf"/>
        </entry>
      </feed>
    `;
    const hits = parseArxivAtom(xml);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.externalId).toBe('2301.00001');
    expect(hits[0]?.title).toBe('A Sample Paper');
    expect(hits[0]?.authors).toEqual(['Ada Lovelace']);
    expect(hits[0]?.doi).toBe('10.1234/example');
    expect(hits[0]?.rights.body).toBe(true);
  });

  it('normalizes arXiv ids and respects restrictive licenses', () => {
    expect(normalizeArxivId('arxiv:1234.5678v2')).toBe('1234.5678');
    expect(resolveArxivRights('https://creativecommons.org/licenses/by-nc-nd/4.0/').body).toBe(
      false,
    );
    expect(resolveArxivRights(undefined).body).toBe(true);
  });

  it('surfaces provider 429 as a recoverable rate-limit job error', async () => {
    const registry = new SourceConnectorRegistry();
    registry.replace(
      new ArxivConnector({
        dnsLookup: async () => ['1.2.3.4'],
        fetchFn: async () =>
          new Response('', {
            status: 429,
            headers: { 'retry-after': '2' },
          }),
      }),
    );

    const cacheStore: ConnectorCacheStore = {
      async get() {
        return null;
      },
      async set() {
        return;
      },
      async delete() {
        return;
      },
    };
    const logger = {
      info() {
        return;
      },
      warn() {
        return;
      },
      error() {
        return;
      },
      debug() {
        return;
      },
    } as unknown as PlatformLogger;

    const rateLimiter = new ConnectorRateLimiter();
    rateLimiter.configure('arxiv', { minIntervalMs: 0 });

    const service = new ConnectorFetchService(
      registry,
      new ConnectorCacheService(cacheStore, new ConnectorMetrics(logger)),
      new ConnectorCircuitBreakerRegistry(),
      rateLimiter,
      new ConnectorMetrics(logger),
    );

    await expect(
      service.execute({
        orgId: '00000000-0000-7000-8000-000000000001',
        connectorId: 'arxiv',
        externalId: '2301.00001',
        purpose: 'metadata',
        freshnessTtl: 60,
        correlationId: 'corr',
      }),
    ).rejects.toBeInstanceOf(ConnectorRateLimitedJobError);
  });
});
