import type { ObjectStorageService } from '../../../l0/ports/object-storage.port';
import type { AdapterInvokeInput, CapabilityAdapter } from '../adapter.port';
import type { AdapterInvokeOutcome } from '../adapter-outcome';
import { AdapterError } from '../adapter.errors';
import { loadOcrObject } from './ocr-storage';

export class OcrCapabilityAdapter implements CapabilityAdapter {
  readonly capability = 'OCR' as const;

  constructor(
    private readonly storage: ObjectStorageService,
    private readonly inner: CapabilityAdapter,
  ) {}

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    if (input.request.capability !== 'OCR') {
      throw new AdapterError(
        'terminal',
        `OcrCapabilityAdapter received ${input.request.capability}`,
      );
    }

    await loadOcrObject(this.storage, input.request.objectKey);
    return this.inner.invoke(input);
  }
}
