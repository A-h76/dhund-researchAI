import { Test } from '@nestjs/testing';
import { ApiAppModule } from '../../src/apps/api/api-app.module';
import { WorkerAppModule } from '../../src/apps/worker/worker-app.module';
import { QUEUE_SERVICE } from '../../src/l0/ports';

const mockQueueService = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
  addJob: jest.fn().mockResolvedValue('job-1'),
};

describe('role module selection', () => {
  it('api module compiles with HTTP controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiAppModule],
    }).compile();

    expect(moduleRef.get(ApiAppModule)).toBeDefined();
    await moduleRef.close();
  });

  it('worker module compiles without HTTP controllers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerAppModule],
    })
      .overrideProvider(QUEUE_SERVICE)
      .useValue(mockQueueService)
      .compile();

    expect(moduleRef.get(WorkerAppModule)).toBeDefined();
    await moduleRef.close();
  });
});
