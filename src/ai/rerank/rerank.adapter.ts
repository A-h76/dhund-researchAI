import { Inject, Injectable } from '@nestjs/common';
import type {
  QueryRerankInput,
  QueryRerankPort,
  QueryRerankResult,
} from '../../retrieval/rerank.port';
import type { IGatewayService } from '../gateway/gateway.port';
import { GATEWAY_SERVICE } from '../tokens';

@Injectable()
export class QueryRerankAdapter implements QueryRerankPort {
  constructor(@Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService) {}

  async rerank(input: QueryRerankInput): Promise<QueryRerankResult> {
    const result = await this.gateway.execute(
      {
        orgId: input.orgId,
        projectId: input.projectId,
        correlationId: input.correlationId,
        runtimeRole: input.runtimeRole,
      },
      {
        capability: 'RERANK',
        query: input.query,
        candidates: input.candidates.map((candidate) => candidate.text),
      },
    );
    if (result.capability !== 'RERANK') {
      throw new Error('query rerank must return Gateway RERANK');
    }
    return {
      scores: result.scores,
      method: result.method,
      aiExecutionId: result.aiExecutionId,
    };
  }
}
