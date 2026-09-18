import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import {
  COUNTER_SERVICE,
  EVIDENCE_LOOKUP,
  RETRIEVAL_INDEX,
  RETRIEVAL_TRACE,
  SCOPED_STORE,
  SESSION_STORE,
  TENANCY_STORE,
} from '../../src/l0/ports';
import { APP_CONFIG } from '../../src/platform/config';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import {
  correlationExpressMiddleware,
  PlatformLogger,
} from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { QUERY_EMBED } from '../../src/retrieval/query-embed.port';
import { QUERY_RERANK } from '../../src/retrieval/rerank.port';
import { AnnSearch } from '../../src/retrieval/ann-search';
import { LexicalSearch } from '../../src/retrieval/lexical-search';
import { RetrievalMetrics } from '../../src/retrieval/retrieval.metrics';
import { RETRIEVAL_SERVICE } from '../../src/retrieval/retrieval.port';
import { RetrievalSearchController } from '../../src/retrieval/retrieval-search.controller';
import { RetrievalSearchService } from '../../src/retrieval/retrieval-search.service';
import { RetrievalService } from '../../src/retrieval/retrieval.service';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemoryCounterService } from '../fixtures/memory-counter';
import { MemoryEvidenceLookup } from '../fixtures/memory-evidence-lookup';
import { MemoryQueryEmbed } from '../fixtures/memory-query-embed';
import { MemoryRerank } from '../fixtures/memory-rerank';
import { MemoryRetrievalIndexStore } from '../fixtures/memory-retrieval-index';
import { MemoryRetrievalTraces } from '../fixtures/memory-retrieval-traces';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';
import { MemorySessionStore } from '../fixtures/memory-session-store';
import { MemoryTenancyStore } from '../fixtures/memory-tenancy-store';
import { tenancyGuardProviders } from '../fixtures/access-auth-providers';
import { stubLogger } from '../fixtures/memory-retrieval-service';

async function json(
  baseUrl: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    [CORRELATION_ID_HEADER]: 'cor-dhb57-http',
    'content-type': 'application/json',
  };
  if (opts.token !== undefined) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { query: 'metformin' }),
  });
  const raw = await response.text();
  return {
    status: response.status,
    body: raw.length === 0 ? null : (JSON.parse(raw) as Record<string, unknown>),
  };
}

async function tokenFor(
  tokens: AccessTokenService,
  sessions: MemorySessionStore,
  userId: string,
): Promise<string> {
  const sessionId = generateId();
  sessions.sessions.set(sessionId, {
    sessionId,
    userId,
    revokedAt: null,
    userSessionVersion: 1,
  });
  return tokens.sign({ sub: userId, sid: sessionId, sv: 1 });
}

describe('DHB-57 retrieval search HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let store: MemoryScopedStore;
  let fts: MemoryRetrievalIndexStore;
  let traces: MemoryRetrievalTraces;
  let evidence: MemoryEvidenceLookup;
  let counters: MemoryCounterService;
  let rerank: MemoryRerank;
  let tokens: AccessTokenService;
  let sessions: MemorySessionStore;
  let projectA: string;
  let projectB: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    const jwt = generateTestJwtConfig();
    const config = installTestAppConfig({ jwt });
    sessions = new MemorySessionStore();
    const tenancy = new MemoryTenancyStore();
    store = new MemoryScopedStore();
    fts = new MemoryRetrievalIndexStore();
    traces = new MemoryRetrievalTraces();
    evidence = new MemoryEvidenceLookup();
    counters = new MemoryCounterService();
    rerank = new MemoryRerank();
    const orgA = generateId();
    const orgB = generateId();
    projectA = generateId();
    projectB = generateId();
    userA = generateId();
    userB = generateId();
    tenancy.seedOrg({ id: orgA, kind: 'TEAM', name: 'Org A', ownerUserId: null });
    tenancy.seedOrg({ id: orgB, kind: 'TEAM', name: 'Org B', ownerUserId: null });
    tenancy.seedProject({ id: projectA, orgId: orgA, name: 'A', settings: {} });
    tenancy.seedProject({ id: projectB, orgId: orgB, name: 'B', settings: {} });
    tenancy.seedOrgMembership({ id: generateId(), orgId: orgA, userId: userA, role: 'MEMBER' });
    tenancy.seedOrgMembership({ id: generateId(), orgId: orgB, userId: userB, role: 'MEMBER' });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId: projectA,
      userId: userA,
      role: 'VIEWER',
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId: projectB,
      userId: userB,
      role: 'VIEWER',
    });

    const logger = stubLogger();
    const moduleRef = await Test.createTestingModule({
      controllers: [RetrievalSearchController],
      providers: [
        RetrievalSearchService,
        RetrievalService,
        { provide: RETRIEVAL_SERVICE, useExisting: RetrievalService },
        AnnSearch,
        LexicalSearch,
        RetrievalMetrics,
        AccessTokenService,
        ...tenancyGuardProviders(),
        { provide: APP_CONFIG, useValue: config },
        { provide: SESSION_STORE, useValue: sessions },
        { provide: TENANCY_STORE, useValue: tenancy },
        { provide: SCOPED_STORE, useValue: store },
        { provide: RETRIEVAL_INDEX, useValue: fts },
        { provide: EVIDENCE_LOOKUP, useValue: evidence },
        { provide: RETRIEVAL_TRACE, useValue: traces },
        { provide: COUNTER_SERVICE, useValue: counters },
        { provide: QUERY_EMBED, useValue: new MemoryQueryEmbed() },
        { provide: QUERY_RERANK, useValue: rerank },
        { provide: PlatformLogger, useValue: logger },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(correlationExpressMiddleware);
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    tokens = app.get(AccessTokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    store.annUnavailable = false;
    fts.ftsUnavailable = false;
    rerank.unavailable = false;
    rerank.method = 'llm';
    store.annHits = [];
    fts.chunks = [];
    evidence.evidence = [];
    traces.rows.splice(0, traces.rows.length);
    counters.counts.clear();
    counters.maxAllowed = null;
  });

  it('returns the Phase 3 §5.1 shape with a durable trace reference', async () => {
    store.annHits = [
      { chunkId: 'keep', projectId: projectA, documentId: 'doc-a', text: 'metformin', vectorScore: 0.2 },
      { chunkId: 'leak', projectId: projectB, documentId: 'doc-b', text: 'metformin' },
    ];
    const token = await tokenFor(tokens, sessions, userA);
    const result = await json(baseUrl, `/v1/projects/${projectA}/retrieval/search`, {
      token,
      body: { query: 'metformin', k: 5 },
    });

    expect(result.status).toBe(200);
    const body = result.body as {
      candidates: Array<Record<string, unknown>>;
      stats: Record<string, unknown>;
      trace: Record<string, unknown>;
    };
    expect(Object.keys(body).sort()).toEqual(['candidates', 'stats', 'trace']);
    expect(body.candidates.map((row) => row.chunkId)).toEqual(['keep']);
    expect(body.candidates[0]?.qualityAnnotation).toBe('body_grounded');
    expect(body.candidates[0]?.evidenceRefs).toEqual([]);
    expect(body.stats.fallbacksUsed).toEqual([]);
    expect(typeof body.stats.latencyMs).toBe('number');
    expect(typeof body.stats.filteredRecallShortfall).toBe('number');
    expect(typeof body.trace.id).toBe('string');
    expect(typeof body.trace.fingerprint).toBe('string');
    expect(traces.rows).toHaveLength(1);
    expect(traces.rows[0]?.queryFingerprint).toBe(body.trace.fingerprint);
    await expect(
      traces.findLatestByFingerprint({ projectId: projectA }, String(body.trace.fingerprint)),
    ).resolves.toMatchObject({ projectId: projectA });
  });

  it('discloses vector degradation and still returns FTS hits', async () => {
    store.annUnavailable = true;
    fts.chunks = [{ chunkId: 'fts-hit', projectId: projectA, documentId: 'doc-a', text: 'metformin adults' }];
    const token = await tokenFor(tokens, sessions, userA);
    const result = await json(baseUrl, `/v1/projects/${projectA}/retrieval/search`, { token });
    expect(result.status).toBe(200);
    const stats = result.body?.stats as { fallbacksUsed: string[] };
    expect(stats.fallbacksUsed).toEqual(['vector']);
    expect((result.body?.candidates as Array<{ chunkId: string }>).map((row) => row.chunkId)).toEqual([
      'fts-hit',
    ]);
  });

  it('discloses FTS and rerank degradation without emptying the response', async () => {
    const token = await tokenFor(tokens, sessions, userA);
    store.annHits = [
      { chunkId: 'v-hit', projectId: projectA, documentId: 'doc-a', text: 'metformin' },
    ];
    fts.ftsUnavailable = true;
    const ftsDown = await json(baseUrl, `/v1/projects/${projectA}/retrieval/search`, { token });
    expect(ftsDown.status).toBe(200);
    expect((ftsDown.body?.stats as { fallbacksUsed: string[] }).fallbacksUsed).toEqual(['fts']);

    fts.ftsUnavailable = false;
    rerank.unavailable = true;
    const rerankDown = await json(baseUrl, `/v1/projects/${projectA}/retrieval/search`, { token });
    expect(rerankDown.status).toBe(200);
    expect((rerankDown.body?.stats as { fallbacksUsed: string[] }).fallbacksUsed).toEqual(['rerank']);
    expect((rerankDown.body?.candidates as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns 500 retrieval_unavailable when both arms are down, not an empty 200', async () => {
    store.annUnavailable = true;
    fts.ftsUnavailable = true;
    const token = await tokenFor(tokens, sessions, userA);
    const result = await json(baseUrl, `/v1/projects/${projectA}/retrieval/search`, { token });
    expect(result.status).toBe(500);
    expect(result.body?.code).toBe(ErrorCode.RetrievalUnavailable);
    expect(result.body?.candidates).toBeUndefined();
    expect(traces.rows).toHaveLength(1);
  });

  it('opts in unresolved evidence when requested', async () => {
    const chunkId = generateId();
    store.annHits = [{ chunkId, projectId: projectA, documentId: 'doc-a', text: 'metformin' }];
    evidence.evidence = [
      {
        id: generateId(),
        chunkId,
        sourceId: generateId(),
        stance: 'unresolved',
        qualityScore: 0.9,
        type: 'body_grounded',
        projectId: projectA,
      },
    ];
    const token = await tokenFor(tokens, sessions, userA);
    const hidden = await json(baseUrl, `/v1/projects/${projectA}/retrieval/search`, {
      token,
      body: { query: 'metformin' },
    });
    expect(hidden.status).toBe(200);
    expect(hidden.body?.candidates).toEqual([]);

    const shown = await json(baseUrl, `/v1/projects/${projectA}/retrieval/search`, {
      token,
      body: { query: 'metformin', includeUnresolved: true },
    });
    expect(shown.status).toBe(200);
    expect((shown.body?.candidates as Array<{ chunkId: string }>).map((row) => row.chunkId)).toEqual([
      chunkId,
    ]);
  });

  it('isolates cross-project search to 404 for the other project path', async () => {
    store.annHits = [{ chunkId: 'b', projectId: projectB, documentId: 'doc-b', text: 'metformin' }];
    const token = await tokenFor(tokens, sessions, userA);
    const result = await json(baseUrl, `/v1/projects/${projectB}/retrieval/search`, { token });
    expect(result.status).toBe(404);
  });

  it('rate-limits the Retrieval class', async () => {
    counters.maxAllowed = 0;
    store.annHits = [{ chunkId: 'c1', projectId: projectA, documentId: 'doc-a', text: 'metformin' }];
    const token = await tokenFor(tokens, sessions, userA);
    const result = await json(baseUrl, `/v1/projects/${projectA}/retrieval/search`, { token });
    expect(result.status).toBe(429);
    expect(result.body?.code).toBe(ErrorCode.RateLimited);
    expect(traces.rows).toHaveLength(0);
  });
});
