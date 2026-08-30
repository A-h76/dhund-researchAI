import { Test } from '@nestjs/testing';
import { JobEnqueueService } from '../../src/platform/logging/job-enqueue.service';
import { QUEUE_SERVICE } from '../../src/l0/ports';
import {
  EnqueueAdmissionService,
  GateSlotRegistry,
} from '../../src/platform/concurrency';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';

describe('JobEnqueueService admission-before-enqueue (DHB-42)', () => {
  it('runs admission before queueService.addJob (privilege-escalation guard)', async () => {
    const order: string[] = [];
    const queueService = {
      addJob: jest.fn(async () => {
        order.push('addJob');
        return 'job-1';
      }),
    };

    const admission = {
      admitBeforeEnqueue: jest.fn(async () => {
        order.push('admit');
        return {
          kind: 'admitted' as const,
          slot: { kind: 'batch' as const, orgId: 'org-1', keys: ['k1'] },
          waitedMs: 0,
        };
      }),
      releaseSlot: jest.fn(),
    };

    const gateSlots = {
      register: jest.fn(async () => {
        order.push('register');
      }),
      releaseByJobId: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        JobEnqueueService,
        { provide: QUEUE_SERVICE, useValue: queueService },
        { provide: EnqueueAdmissionService, useValue: admission },
        { provide: GateSlotRegistry, useValue: gateSlots },
      ],
    }).compile();

    const enqueue = moduleRef.get(JobEnqueueService);

    await runWithCorrelationIdAsync('cor-admit-1', async () => {
      await enqueue.enqueue('extract', {
        orgId: 'org-1',
        projectId: 'proj-1',
        documentVersionId: 'dv-1',
        contentHash: 'hash-1',
        extractorVersion: 'v1',
      });
    });

    expect(order).toEqual(['admit', 'register', 'addJob']);
    expect(admission.admitBeforeEnqueue).toHaveBeenCalledTimes(1);
    expect(queueService.addJob).toHaveBeenCalledTimes(1);
    await moduleRef.close();
  });

  it('passes delayMs when admission demotes instead of failing', async () => {
    const queueService = {
      addJob: jest.fn(async () => 'job-delayed'),
    };

    const admission = {
      admitBeforeEnqueue: jest.fn(async () => ({
        kind: 'demoted' as const,
        delayMs: 60_000,
        waitedMs: 30_000,
      })),
      releaseSlot: jest.fn(),
    };

    const gateSlots = {
      register: jest.fn(),
      releaseByJobId: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        JobEnqueueService,
        { provide: QUEUE_SERVICE, useValue: queueService },
        { provide: EnqueueAdmissionService, useValue: admission },
        { provide: GateSlotRegistry, useValue: gateSlots },
      ],
    }).compile();

    const enqueue = moduleRef.get(JobEnqueueService);

    await runWithCorrelationIdAsync('cor-admit-2', async () => {
      await enqueue.enqueue('chunk', {
        orgId: 'org-1',
        projectId: 'proj-1',
        documentVersionId: 'dv-2',
        contentHash: 'hash-2',
        chunkerVersion: 'v1',
      });
    });

    expect(queueService.addJob).toHaveBeenCalledWith(
      'chunk',
      expect.objectContaining({ orgId: 'org-1' }),
      expect.objectContaining({ delayMs: 60_000 }),
    );
    expect(gateSlots.register).not.toHaveBeenCalled();
    await moduleRef.close();
  });
});
