import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { HealthController } from '../../src/apps/api/health.controller';
import { ReadinessService } from '../../src/platform/config';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { correlationExpressMiddleware } from '../../src/platform/logging';

describe('health controller', () => {
  let app: INestApplication;
  let readiness: { isReady: jest.Mock };
  let baseUrl: string;

  beforeAll(async () => {
    readiness = { isReady: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: ReadinessService, useValue: readiness }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(correlationExpressMiddleware);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    readiness.isReady.mockReset();
  });

  it('returns 200 from /health without dependency checks', async () => {
    readiness.isReady.mockResolvedValue(false);

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(readiness.isReady).not.toHaveBeenCalled();
  });

  it('returns 200 from /ready when dependencies are ready', async () => {
    readiness.isReady.mockResolvedValue(true);

    const response = await fetch(`${baseUrl}/ready`, {
      headers: { [CORRELATION_ID_HEADER]: 'cor-ready-1' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
    expect(response.headers.get(CORRELATION_ID_HEADER)).toBe('cor-ready-1');
  });

  it('returns 503 from /ready when dependencies are unavailable', async () => {
    readiness.isReady.mockResolvedValue(false);

    const response = await fetch(`${baseUrl}/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unready' });
  });
});
