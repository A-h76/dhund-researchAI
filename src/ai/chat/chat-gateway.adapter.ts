import { Inject, Injectable } from '@nestjs/common';
import type {
  ChatGatewayInput,
  ChatGatewayPort,
  ChatGatewayResult,
} from '../../orchestration/chat-gateway.port';
import type { IGatewayService } from '../gateway/gateway.port';
import { GATEWAY_SERVICE } from '../tokens';

@Injectable()
export class ChatGatewayAdapter implements ChatGatewayPort {
  constructor(@Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService) {}

  async chat(input: ChatGatewayInput): Promise<ChatGatewayResult> {
    const result = await this.gateway.execute(
      {
        orgId: input.orgId,
        projectId: input.projectId,
        correlationId: input.correlationId,
        runtimeRole: input.runtimeRole,
      },
      {
        capability: 'CHAT',
        userMessage: input.userMessage,
        documentContent: input.documentContent,
        retrievalFingerprint: input.retrievalFingerprint,
        retrievalTraceId: input.retrievalTraceId,
      },
      input.onToken !== undefined ? { onToken: input.onToken } : {},
    );
    if (result.capability !== 'CHAT') {
      throw new Error('chat gateway must return Gateway CHAT');
    }
    return {
      text: result.text,
      aiExecutionId: result.aiExecutionId,
      inputFingerprint: result.inputFingerprint,
      method: result.method,
      tokensIn: result.metrics.tokensIn,
      tokensOut: result.metrics.tokensOut,
      costMicros: result.metrics.costMicros,
      latencyMs: result.metrics.latencyMs,
    };
  }
}
