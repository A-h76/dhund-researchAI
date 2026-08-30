import { assertValidQueuePayload } from '../../src/platform/queues';
import {
  assertValidJobPayload,
  InvalidJobPayloadError,
} from '../../src/platform/logging/job-payload';

describe('queue payload validators (DHB-40)', () => {
  it('rejects payloads missing correlationId at consume time', () => {
    expect(() =>
      assertValidQueuePayload('extract', {
        orgId: 'org-1',
        projectId: 'proj-1',
        documentVersionId: 'dv-1',
        contentHash: 'hash-1',
        extractorVersion: 'v1',
      }),
    ).toThrow(InvalidJobPayloadError);
  });

  it('requires queue-specific fields for extract', () => {
    expect(() =>
      assertValidQueuePayload('extract', {
        orgId: 'org-1',
        correlationId: 'cor-1',
        projectId: 'proj-1',
        documentVersionId: 'dv-1',
        contentHash: 'hash-1',
      }),
    ).toThrow('extractorVersion');
  });

  it('accepts a valid extract payload', () => {
    const payload = {
      orgId: 'org-1',
      correlationId: 'cor-1',
      projectId: 'proj-1',
      documentVersionId: 'dv-1',
      contentHash: 'hash-1',
      extractorVersion: 'v1',
    };
    expect(() => assertValidQueuePayload('extract', payload)).not.toThrow();
    expect(() => assertValidJobPayload(payload)).not.toThrow();
  });
});
