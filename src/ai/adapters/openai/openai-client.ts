import { AdapterError, classifyProviderError, isAdapterError } from '../adapter.errors';
import type { AdapterClock } from '../clock';

export interface OpenAiCompletionRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPayload: string;
  readonly stream: boolean;
}

export interface OpenAiCompletionResponse {
  readonly text: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly latencyMs: number;
}

export interface OpenAiClient {
  complete(request: OpenAiCompletionRequest): Promise<OpenAiCompletionResponse>;
}

const MAX_429_RETRIES = 3;
const BASE_BACKOFF_MS = 100;

export async function invokeOpenAiWith429Backoff<T>(
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
      await clock.sleep(BASE_BACKOFF_MS * 2 ** attempt);
    }
  }

  throw lastError ?? new AdapterError('unavailable', 'OpenAI invocation failed');
}
