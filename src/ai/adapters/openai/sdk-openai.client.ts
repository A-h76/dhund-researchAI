import { Inject, Injectable, Optional } from '@nestjs/common';
import OpenAI from 'openai';
import { SECRETS_SERVICE, type SecretsService } from '../../../l0/ports';
import { AdapterError } from '../adapter.errors';
import type { AdapterClock } from '../clock';
import { SystemAdapterClock } from '../clock';
import {
  invokeOpenAiWith429Backoff,
  type OpenAiClient,
  type OpenAiCompletionRequest,
  type OpenAiCompletionResponse,
} from './openai-client';

@Injectable()
export class SdkOpenAiClient implements OpenAiClient {
  private readonly clock: AdapterClock;

  constructor(
    @Inject(SECRETS_SERVICE) private readonly secrets: SecretsService,
    @Optional() clock?: AdapterClock,
  ) {
    this.clock = clock ?? new SystemAdapterClock();
  }

  async complete(request: OpenAiCompletionRequest): Promise<OpenAiCompletionResponse> {
    const apiKey = this.secrets.getSecret('OPENAI_API_KEY');
    if (apiKey === undefined) {
      throw new AdapterError('auth', 'OPENAI_API_KEY is not configured');
    }

    const client = new OpenAI({ apiKey });
    const messages = [
      { role: 'system' as const, content: request.systemPrompt },
      { role: 'user' as const, content: request.userPayload },
    ];
    const started = Date.now();

    return invokeOpenAiWith429Backoff(async () => {
      if (request.stream) {
        return this.completeStreaming(
          client,
          request.model,
          messages,
          started,
          request.onToken,
        );
      }

      const response = await client.chat.completions.create({
        model: request.model,
        messages,
      });

      return {
        text: response.choices[0]?.message?.content ?? '',
        tokensIn: response.usage?.prompt_tokens ?? 0,
        tokensOut: response.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - started,
      };
    }, this.clock);
  }

  private async completeStreaming(
    client: OpenAI,
    model: string,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    started: number,
    onToken: ((token: string) => void) | undefined,
  ): Promise<OpenAiCompletionResponse> {
    const stream = await client.chat.completions.create({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = '';
    let tokensIn = 0;
    let tokensOut = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        text += delta;
        if (onToken !== undefined) {
          try {
            onToken(delta);
          } catch {
            // Disconnect or sink failure must not cancel generation (DHB-62).
          }
        }
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? tokensIn;
        tokensOut = chunk.usage.completion_tokens ?? tokensOut;
      }
    }

    return {
      text,
      tokensIn,
      tokensOut,
      latencyMs: Date.now() - started,
    };
  }
}
