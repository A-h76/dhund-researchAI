import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { WritingSentenceBindingsController } from '../../src/apps/api/writing-sentence-bindings.controller';
import { SentenceProjectionService } from '../../src/evidence/sentence-projection.service';
import { notFound } from '../../src/platform/errors/domain-error';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import { PlatformLogger } from '../../src/platform/logging';

describe('DHB-61 sentence-bindings HTTP security', () => {
  jest.setTimeout(30_000);
  async function startApp(
    projectSentence: SentenceProjectionService['projectSentence'],
  ): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [WritingSentenceBindingsController],
      providers: [
        { provide: SentenceProjectionService, useValue: { projectSentence } },
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

  it('returns 404 when writingId belongs to another project', async () => {
    const app = await startApp(async (input) => {
      if (input.projectId !== 'proj-home' || input.writingId !== 'wrt-home') {
        throw notFound({ module: 'evidence' });
      }
      return {
        writingId: input.writingId,
        projectId: input.projectId,
        writingVersionId: 'ver-1',
        sentenceHash: input.sentenceHash,
        status: 'complete',
        chains: [],
      };
    });
    const baseUrl = await app.getUrl();
    try {
      const response = await fetch(
        `${baseUrl}/v1/writing/wrt-other/sentence-bindings/hash-1?projectId=proj-home`,
      );
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(404);
      expect(body.code).toBe(ErrorCode.NotFound);
    } finally {
      await app.close();
    }
  });

  it('returns 422 when projectId is omitted', async () => {
    const app = await startApp(async () => {
      throw new Error('should not project');
    });
    const baseUrl = await app.getUrl();
    try {
      const response = await fetch(`${baseUrl}/v1/writing/wrt-1/sentence-bindings/hash-1`);
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(422);
      expect(body.code).toBe(ErrorCode.ValidationError);
    } finally {
      await app.close();
    }
  });
});
