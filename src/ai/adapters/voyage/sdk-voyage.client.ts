import { Inject, Injectable, Optional } from '@nestjs/common';
import { VoyageAIClient } from 'voyageai';
import { SECRETS_SERVICE, type SecretsService } from '../../../l0/ports';
import { EMBED_DIMENSION } from '../../policy/embed-policy.constants';
import { AdapterError } from '../adapter.errors';
import type { AdapterClock } from '../clock';
import { SystemAdapterClock } from '../clock';
import {
  invokeWith429Backoff,
  type VoyageEmbedClient,
  type VoyageEmbedRequest,
  type VoyageEmbedResponse,
} from './voyage-client';

@Injectable()
export class SdkVoyageClient implements VoyageEmbedClient {
  private readonly clock: AdapterClock;

  constructor(
    @Inject(SECRETS_SERVICE) private readonly secrets: SecretsService,
    @Optional() clock?: AdapterClock,
  ) {
    this.clock = clock ?? new SystemAdapterClock();
  }

  async embed(request: VoyageEmbedRequest): Promise<VoyageEmbedResponse> {
    const apiKey = this.secrets.getSecret('VOYAGE_API_KEY');
    if (apiKey === undefined) {
      throw new AdapterError('auth', 'VOYAGE_API_KEY is not configured');
    }

    const client = new VoyageAIClient({ apiKey });
    const started = Date.now();

    return invokeWith429Backoff(async () => {
      const response = await client.embed({
        input: [...request.texts],
        model: request.model,
        inputType: request.inputType,
        outputDimension: EMBED_DIMENSION,
      });

      const vectors = (response.data ?? []).map((item) => item.embedding ?? []);
      const tokensIn =
        typeof response.usage?.totalTokens === 'number'
          ? response.usage.totalTokens
          : request.texts.length;

      return {
        vectors,
        tokensIn,
        latencyMs: Date.now() - started,
      };
    }, this.clock);
  }
}
