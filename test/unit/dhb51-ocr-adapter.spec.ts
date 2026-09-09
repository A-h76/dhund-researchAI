import { AdapterError } from '../../src/ai/adapters/adapter.errors';
import { OcrCapabilityAdapter } from '../../src/ai/adapters/ocr/ocr-capability.adapter';
import { loadOcrObject, OCR_OBJECT_MAX_BYTES, OCR_PRESIGN_TTL_SECONDS } from '../../src/ai/adapters/ocr/ocr-storage';
import { StubOcrAdapter } from '../../src/ai/adapters/stub/stub-adapters';
import type { AdapterInvokeInput, CapabilityAdapter } from '../../src/ai/adapters/adapter.port';
import type { AdapterInvokeOutcome } from '../../src/ai/adapters/adapter-outcome';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { MAX_UPLOAD_BYTES } from '../../src/ingestion/upload.constants';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';

function ocrInput(objectKey: string): AdapterInvokeInput {
  const request = { capability: 'OCR' as const, objectKey };
  const policy = new PolicyResolver().resolve(request);
  return {
    ctx: {
      orgId: '00000000-0000-7000-8000-000000000001',
      correlationId: 'cor-ocr-adapter',
      runtimeRole: RuntimeRole.Worker,
    },
    policy,
    payload: new PromptAssembler().assemble(request, policy),
    request,
  };
}

describe('DHB-51 OCR storage access after Gateway', () => {
  it('mints a short-lived GET and reads object bytes for OCR', async () => {
    const storage = new MemoryObjectStorage();
    const key = 'uploads/scan.pdf';
    storage.put(key, Buffer.from('%PDF-1.4 scanned'));
    const spyGet = jest.spyOn(storage, 'getPresignedGetUrl');
    const spyBytes = jest.spyOn(storage, 'getObjectBytes');

    const bytes = await loadOcrObject(storage, key);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(spyGet).toHaveBeenCalledWith(key, OCR_PRESIGN_TTL_SECONDS);
    expect(OCR_PRESIGN_TTL_SECONDS).toBe(120);
    expect(OCR_PRESIGN_TTL_SECONDS).toBeLessThan(900);
    expect(spyBytes).toHaveBeenCalledWith(key, OCR_OBJECT_MAX_BYTES);
    expect(OCR_OBJECT_MAX_BYTES).toBe(MAX_UPLOAD_BYTES);
  });

  it('refuses missing OCR objects as a terminal adapter error', async () => {
    const storage = new MemoryObjectStorage();
    await expect(loadOcrObject(storage, 'missing.pdf')).rejects.toBeInstanceOf(AdapterError);
  });

  it('stub OCR adapter uses stored bytes before returning pages', async () => {
    const storage = new MemoryObjectStorage();
    storage.put('uploads/scan.pdf', Buffer.from('%PDF-1.4 scanned'));
    const spyBytes = jest.spyOn(storage, 'getObjectBytes');
    const adapter = new StubOcrAdapter(storage);
    const outcome = await adapter.invoke(ocrInput('uploads/scan.pdf'));
    expect(spyBytes).toHaveBeenCalled();
    expect(outcome.result?.capability).toBe('OCR');
    if (outcome.result?.capability === 'OCR') {
      expect(outcome.result.text).toBe('stub-ocr-text');
      expect(outcome.result.pages[0]?.blocks[0]?.text).toBe('stub-ocr-text');
    }
  });

  it('live OCR wrapper loads storage before the inner adapter', async () => {
    const storage = new MemoryObjectStorage();
    storage.put('uploads/scan.pdf', Buffer.from('%PDF-1.4 scanned'));
    const inner: CapabilityAdapter = {
      capability: 'OCR',
      invoke: jest.fn().mockResolvedValue({
        status: 'ok',
        method: 'llm',
        result: {
          capability: 'OCR',
          text: 'inner',
          pages: [],
          meanConfidence: 1,
          inputFingerprint: 'fp',
          promptVersion: 'ocr_v1',
          provider: 'openai',
          model: 'gpt-4o-mini',
          metrics: { latencyMs: 1, tokensIn: 0, tokensOut: 0, costMicros: 0 },
        },
        attempts: [],
        tokensIn: 0,
        tokensOut: 0,
        costMicros: 0,
      } satisfies AdapterInvokeOutcome),
    };
    const spyBytes = jest.spyOn(storage, 'getObjectBytes');
    const adapter = new OcrCapabilityAdapter(storage, inner);
    await adapter.invoke(ocrInput('uploads/scan.pdf'));
    expect(inner.invoke).toHaveBeenCalledTimes(1);
    expect(spyBytes).toHaveBeenCalledWith('uploads/scan.pdf', OCR_OBJECT_MAX_BYTES);
  });
});
