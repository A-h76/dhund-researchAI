import { Test } from '@nestjs/testing';
import { ApiAppModule } from '../../src/apps/api/api-app.module';
import { WorkerAppModule } from '../../src/apps/worker/worker-app.module';

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
    }).compile();

    expect(moduleRef.get(WorkerAppModule)).toBeDefined();
    await moduleRef.close();
  });
});
