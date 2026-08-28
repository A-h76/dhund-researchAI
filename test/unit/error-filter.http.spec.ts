import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DomainError, notFound, passwordRejected } from '../../src/platform/errors/domain-error';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { ApiAppModule } from '../../src/apps/api/api-app.module';
import { WorkerAppModule } from '../../src/apps/worker/worker-app.module';
import { QUEUE_SERVICE } from '../../src/l0/ports';

const PASSWORD_SECRET = 'N0tInBody-hunter2-leak-check';
const SQL_LEAK =
  'Unique constraint failed on the constraint: `users_email_key` on table public.users';
const PROVIDER_LEAK = 'Voyage voyage-4 timeout at api.voyageai.com';
const SSRF_TARGET = 'http://169.254.169.254/latest/meta-data';

class FakePrismaError extends Error {
  readonly code = 'P2002';
  readonly clientVersion = '6.4.1';
  readonly meta = {
    modelName: 'User',
    target: ['email'],
    table: 'users',
  };

  constructor() {
    super(SQL_LEAK);
    this.name = 'PrismaClientKnownRequestError';
  }
}

@Controller('probe')
class ErrorProbeController {
  @Get('not-found')
  notFoundProbe(): never {
    throw notFound({
      serverDetail: { existsInOtherTenant: true, projectId: 'proj_other' },
    });
  }

  @Get('password')
  passwordProbe(): never {
    throw passwordRejected('min_length');
  }

  @Get('password-leak')
  passwordLeakProbe(): never {
    throw new DomainError(ErrorCode.ValidationError, {
      details: {
        fields: [{ field: 'password', rule: 'breached' }],
        password: PASSWORD_SECRET,
      },
      serverDetail: { password: PASSWORD_SECRET },
    });
  }

  @Get('unhandled')
  unhandledProbe(): never {
    throw new Error(`stack boom ${SQL_LEAK}`);
  }

  @Get('prisma')
  prismaProbe(): never {
    throw new FakePrismaError();
  }

  @Get('ssrf')
  ssrfProbe(): never {
    throw new DomainError(ErrorCode.UrlTargetBlocked, {
      details: { url: SSRF_TARGET },
      serverDetail: { url: SSRF_TARGET },
    });
  }

  @Get('provider')
  providerProbe(): never {
    throw new DomainError(ErrorCode.AiUnavailable, {
      cause: new Error(PROVIDER_LEAK),
      serverDetail: { provider: 'voyage', model: 'voyage-4' },
    });
  }

  @Get('quota')
  quotaProbe(): never {
    throw new DomainError(ErrorCode.QuotaExceeded, {
      details: { metric: 'ai_cost_micros', limit: 5000000, observed: 5012400 },
    });
  }

  @Get('internal')
  internalProbe(): never {
    throw new DomainError(ErrorCode.InternalError, {
      userMessage: 'this must not reach the client',
      details: { table: 'public.users' },
    });
  }
}

@Module({
  controllers: [ErrorProbeController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class ErrorProbeModule {}

interface HttpResult {
  status: number;
  body: Record<string, unknown>;
  raw: string;
}

async function startProbe(): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({
    imports: [ErrorProbeModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: await app.getUrl() };
}

async function getJson(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const raw = await response.text();
  return {
    status: response.status,
    body: JSON.parse(raw) as Record<string, unknown>,
    raw,
  };
}

function capturedLogs(spy: jest.SpyInstance): string {
  return spy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
}

describe('global exception filter HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;
  let logSpy: jest.SpyInstance;

  beforeAll(async () => {
    ({ app, baseUrl } = await startProbe());
  });

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the 4xx envelope for DomainError not_found without existence details', async () => {
    const result = await getJson(baseUrl, '/probe/not-found');

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      code: ErrorCode.NotFound,
      message: 'Resource not found.',
      correlationId: expect.any(String),
    });
    expect(result.body.details).toBeUndefined();
    expect(result.raw).not.toContain('proj_other');
    expect(result.raw).not.toContain('existsInOtherTenant');
  });

  it('returns password details per GAP-PASSWORD-01 without the password value', async () => {
    const result = await getJson(baseUrl, '/probe/password');

    expect(result.status).toBe(422);
    expect(result.body.code).toBe(ErrorCode.ValidationError);
    expect(result.body.message).toBe('Password does not meet requirements.');
    expect(result.body.details).toEqual({
      fields: [{ field: 'password', rule: 'min_length', min: 12 }],
    });
    expect(Object.keys(result.body).sort()).toEqual(
      ['code', 'correlationId', 'details', 'message'].sort(),
    );
  });

  it('strips leaked password values from 4xx bodies and captured logs', async () => {
    const result = await getJson(baseUrl, '/probe/password-leak');
    const logs = capturedLogs(logSpy);

    expect(result.status).toBe(422);
    expect(result.body.details).toBeUndefined();
    expect(result.raw).not.toContain(PASSWORD_SECRET);
    expect(logs).not.toContain(PASSWORD_SECRET);
  });

  it('returns 4xx quota envelope with safe details', async () => {
    const result = await getJson(baseUrl, '/probe/quota', {
      [CORRELATION_ID_HEADER]: 'cor_quota_1',
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      code: ErrorCode.QuotaExceeded,
      message: 'A usage limit for this organization has been reached.',
      details: { metric: 'ai_cost_micros', limit: 5000000, observed: 5012400 },
      correlationId: 'cor_quota_1',
    });
  });

  it('returns 5xx DomainError as code + correlationId only', async () => {
    const result = await getJson(baseUrl, '/probe/internal');

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      code: ErrorCode.InternalError,
      correlationId: expect.any(String),
    });
    expect(result.body.message).toBeUndefined();
    expect(result.body.details).toBeUndefined();
    expect(result.raw).not.toContain('this must not reach the client');
    expect(result.raw).not.toContain('public.users');
  });

  it('maps unhandled Error to 500 internal_error without leak', async () => {
    const result = await getJson(baseUrl, '/probe/unhandled');
    const logs = capturedLogs(logSpy);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      code: ErrorCode.InternalError,
      correlationId: expect.any(String),
    });
    expect(Object.keys(result.body)).toEqual(['code', 'correlationId']);
    expect(result.raw).not.toContain('constraint');
    expect(result.raw).not.toContain('public.users');
    expect(logs).not.toContain('constraint');
    expect(logs).not.toContain('public.users');
  });

  it('maps fake Prisma/driver errors to 500 without SQL/table/constraint names', async () => {
    const result = await getJson(baseUrl, '/probe/prisma');
    const logs = capturedLogs(logSpy);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      code: ErrorCode.InternalError,
      correlationId: expect.any(String),
    });
    expect(result.raw).not.toContain('users_email_key');
    expect(result.raw).not.toContain('public.users');
    expect(result.raw).not.toContain('P2002');
    expect(result.raw).not.toContain('Prisma');
    expect(logs).not.toContain('users_email_key');
    expect(logs).not.toContain('public.users');
    expect(logs).not.toContain('P2002');
  });

  it('returns url_target_blocked without SSRF target leakage in body or logs', async () => {
    const result = await getJson(baseUrl, '/probe/ssrf');
    const logs = capturedLogs(logSpy);

    expect(result.status).toBe(400);
    expect(result.body.code).toBe(ErrorCode.UrlTargetBlocked);
    expect(result.body.message).toEqual(expect.any(String));
    expect(result.body.details).toBeUndefined();
    expect(result.raw).not.toContain('169.254.169.254');
    expect(logs).not.toContain('169.254.169.254');
  });

  it('returns provider failure as 5xx without provider/model leakage', async () => {
    const result = await getJson(baseUrl, '/probe/provider');
    const logs = capturedLogs(logSpy);

    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      code: ErrorCode.AiUnavailable,
      correlationId: expect.any(String),
    });
    expect(result.raw).not.toContain('voyage');
    expect(result.raw).not.toContain('Voyage');
    expect(logs.toLowerCase()).not.toContain('voyage');
  });
});

describe('filter registration and existing role behavior', () => {
  const mockQueueService = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue(true),
    addJob: jest.fn().mockResolvedValue('job-1'),
  };

  it('does not register the global filter on the worker application', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerAppModule],
    })
      .overrideProvider(QUEUE_SERVICE)
      .useValue(mockQueueService)
      .compile();

    expect(() => moduleRef.get(APP_FILTER)).toThrow();
    await moduleRef.close();
  });

  it('keeps the DHB-23 API root contract and applies the envelope to unknown routes', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [ApiAppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const baseUrl = await app.getUrl();

    try {
      const root = await fetch(`${baseUrl}/`);
      expect(root.status).toBe(200);
      expect(await root.json()).toEqual({ status: 'ok' });

      const missing = await fetch(`${baseUrl}/__dhb25-missing`);
      const body = (await missing.json()) as Record<string, unknown>;
      expect(missing.status).toBe(404);
      expect(body.code).toBe(ErrorCode.NotFound);
      expect(body.message).toEqual(expect.any(String));
      expect(body.correlationId).toEqual(expect.any(String));
      expect(body.details).toBeUndefined();
    } finally {
      logSpy.mockRestore();
      await app.close();
    }
  });
});
