import { Inject, Injectable } from '@nestjs/common';
import { EmbeddingDimensionMismatchError } from '../../l0/ports';
import type { QueryEmbedInput, QueryEmbedPort } from '../../retrieval/query-embed.port';
import type { IGatewayService } from '../gateway/gateway.port';
import {
  EMBED_DIMENSION,
  EMBED_QUERY_INPUT_TYPE,
} from '../policy/embed-policy.constants';
import { GATEWAY_SERVICE } from '../tokens';

@Injectable()
export class QueryEmbedAdapter implements QueryEmbedPort {
  constructor(@Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService) {}

  async embedQuery(input: QueryEmbedInput): Promise<string> {
    const result = await this.gateway.execute(
      {
        orgId: input.orgId,
        projectId: input.projectId,
        correlationId: input.correlationId,
        runtimeRole: input.runtimeRole,
      },
      {
        capability: 'EMBED',
        texts: [input.text],
        inputType: EMBED_QUERY_INPUT_TYPE,
        expectedDimensions: [EMBED_DIMENSION],
      },
    );
    if (result.capability !== 'EMBED' || result.inputType !== EMBED_QUERY_INPUT_TYPE) {
      throw new Error('query embed must return Gateway EMBED with input_type=query');
    }
    const vector = result.vectors[0];
    if (vector === undefined) {
      throw new EmbeddingDimensionMismatchError('query', 0);
    }
    if (vector.length !== EMBED_DIMENSION) {
      throw new EmbeddingDimensionMismatchError('query', vector.length);
    }
    return `[${vector.join(',')}]`;
  }
}
