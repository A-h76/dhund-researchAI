import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { CapabilityProbeController } from '../../src/apps/api/capability-probe.controller';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import {
  APP_CONFIG,
  evaluateAuthorizationDecision,
  FeatureFlagsService,
  resetAppConfigForTests,
} from '../../src/platform/config';
import { PlatformLogger } from '../../src/platform/logging';
import { installTestAppConfig } from '../fixtures/app-config.fixture';

describe('feature flags authorization conformance', () => {
  afterEach(() => {
    resetAppConfigForTests();
  });

  it('keeps authorization decisions identical regardless of feature flag state', () => {
    const flagsOff = new FeatureFlagsService(
      installTestAppConfig({ featureFlags: { research_runs: false } }),
    );
    const flagsOn = new FeatureFlagsService(
      installTestAppConfig({ featureFlags: { research_runs: true } }),
    );

    expect(evaluateAuthorizationDecision(true, flagsOff)).toBe('allow');
    expect(evaluateAuthorizationDecision(true, flagsOn)).toBe('allow');
    expect(evaluateAuthorizationDecision(false, flagsOff)).toBe('deny');
    expect(evaluateAuthorizationDecision(false, flagsOn)).toBe('deny');
  });

  async function startProbeApp(
    config = installTestAppConfig({ featureFlags: { research_runs: false } }),
  ): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [CapabilityProbeController],
      providers: [
        FeatureFlagsService,
        { provide: APP_CONFIG, useValue: config },
        {
          provide: PlatformLogger,
          useValue: {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
          },
        },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    return app;
  }

  it('returns 404 when a disabled capability is requested', async () => {
    const app = await startProbeApp(
      installTestAppConfig({ featureFlags: { research_runs: false } }),
    );
    const baseUrl = await app.getUrl();

    try {
      const response = await fetch(`${baseUrl}/capabilities/research-runs`);
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(404);
      expect(body.code).toBe(ErrorCode.NotFound);
      expect(body.code).not.toBe(ErrorCode.FeatureNotAvailable);
    } finally {
      await app.close();
    }
  });

  it('returns 200 when an enabled capability is requested', async () => {
    const app = await startProbeApp(
      installTestAppConfig({ featureFlags: { research_runs: true } }),
    );
    const baseUrl = await app.getUrl();

    try {
      const response = await fetch(`${baseUrl}/capabilities/research-runs`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'available' });
    } finally {
      await app.close();
    }
  });
});
