import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { HealthController } from '../../src/apps/api/health.controller';
import { ReadinessService } from '../../src/platform/config';
import { correlationExpressMiddleware } from '../../src/platform/logging';

describe('readiness security', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: ReadinessService,
          useValue: {
            isReady: jest.fn().mockResolvedValue(false),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(correlationExpressMiddleware);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not expose infrastructure details in readiness responses', async () => {
    const response = await fetch(`${baseUrl}/ready`);
    const raw = await response.text();

    expect(raw).toBe('{"status":"unready"}');
    expect(raw.toLowerCase()).not.toContain('postgres');
    expect(raw.toLowerCase()).not.toContain('redis');
    expect(raw.toLowerCase()).not.toContain('localhost');
    expect(raw.toLowerCase()).not.toContain('password');
    expect(raw.toLowerCase()).not.toContain('migration');
    expect(raw.toLowerCase()).not.toContain('version');
  });

  it('does not expose infrastructure details in liveness responses', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const raw = await response.text();

    expect(raw).toBe('{"status":"ok"}');
    expect(raw.toLowerCase()).not.toContain('postgres');
    expect(raw.toLowerCase()).not.toContain('redis');
  });
});
