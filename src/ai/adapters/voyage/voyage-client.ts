import type { EmbedInputType } from '../../policy/embed-policy.constants';
import { AdapterError, classifyProviderError, isAdapterError } from '../adapter.errors';
import type { AdapterClock } from '../clock';
import { SystemAdapterClock } from '../clock';

export interface VoyageEmbedRequest {
  readonly model: string;
  readonly texts: readonly string[];
  readonly inputType: EmbedInputType;
}

export interface VoyageEmbedResponse {
  readonly vectors: readonly (readonly number[])[];
  readonly tokensIn: number;
  readonly latencyMs: number;
}

export interface VoyageEmbedClient {
  embed(request: VoyageEmbedRequest): Promise<VoyageEmbedResponse>;
}

const MAX_429_RETRIES = 3;
const BASE_BACKOFF_MS = 100;

export async function invokeWith429Backoff<T>(
  operation: () => Promise<T>,
  clock: AdapterClock,
): Promise<T> {
  let lastError: AdapterError | undefined;

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const classified = isAdapterError(error) ? error : classifyProviderError(error);
      lastError = classified;
      if (classified.kind !== 'rate_limited' || attempt === MAX_429_RETRIES) {
        throw classified;
      }
      const delayMs = BASE_BACKOFF_MS * 2 ** attempt;
      await clock.sleep(delayMs);
    }
  }

  throw lastError ?? new AdapterError('unavailable', 'Voyage invocation failed');
}

export { SystemAdapterClock };
