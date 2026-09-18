import { Inject, Injectable } from '@nestjs/common';
import {
  MESSAGE_EVIDENCE_BINDING,
  type MessageEvidenceBindingStore,
  type ProjectScope,
  type ScopedRow,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId } from '../platform/ids/uuid-v7';
import { RuntimeRole } from '../platform/runtime/role';
import {
  RETRIEVAL_SERVICE,
  type IRetrievalService,
} from '../retrieval/retrieval.port';
import { assembleChatContext } from './chat-context';
import { CHAT_GATEWAY, type ChatGatewayPort } from './chat-gateway.port';
import { ChatMetrics } from './chat.metrics';
import {
  CHAT_STREAM_SINK,
  type ChatStreamSink,
} from './chat-stream.port';
import { ConversationsRepository, MessagesRepository } from './scoped-repos';

const MODULE = 'orchestration';
const CHAT_RETRIEVAL_K = 12;

export interface SendMessageInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly content: string;
  readonly correlationId: string;
  readonly runtimeRole: RuntimeRole;
  /** Optional forced sequence for collision tests. */
  readonly sequence?: number;
}

export interface SendMessageResult {
  readonly userMessage: ScopedRow;
  readonly assistantMessage: ScopedRow;
  readonly evidenceIds: readonly string[];
  readonly retrievalTraceId: string;
  readonly retrievalFingerprint: string;
  readonly aiExecutionId: string;
  readonly inputFingerprint: string;
  readonly ttftMs: number | null;
  readonly chatLatencyMs: number;
  readonly retrievalLatencyMs: number;
}

@Injectable()
export class PaperChatService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    @Inject(RETRIEVAL_SERVICE) private readonly retrieval: IRetrievalService,
    @Inject(CHAT_GATEWAY) private readonly chatGateway: ChatGatewayPort,
    @Inject(MESSAGE_EVIDENCE_BINDING)
    private readonly bindings: MessageEvidenceBindingStore,
    @Inject(CHAT_STREAM_SINK) private readonly stream: ChatStreamSink,
    private readonly metrics: ChatMetrics,
  ) {}

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const scope: ProjectScope = { projectId: input.projectId };
    await this.conversations.get(scope, input.conversationId);

    const userSequence =
      input.sequence ?? (await this.messages.nextSequence(scope, input.conversationId));
    const userMessage = await this.messages.create(scope, {
      conversationId: input.conversationId,
      role: 'user',
      content: input.content,
      status: 'complete',
      sequence: userSequence,
    });

    const assistantSequence = userSequence + 1;
    const assistantMessage = await this.messages.create(scope, {
      conversationId: input.conversationId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      sequence: assistantSequence,
    });

    const retrievalStarted = Date.now();
    const retrieval = await this.retrieval.retrieve({
      orgId: input.orgId,
      projectId: input.projectId,
      query: input.content,
      k: CHAT_RETRIEVAL_K,
      correlationId: input.correlationId,
      runtimeRole: input.runtimeRole,
    });
    const retrievalLatencyMs = Date.now() - retrievalStarted;

    const context = assembleChatContext(retrieval.hits);
    let firstTokenAt: number | null = null;
    const chatStarted = Date.now();

    try {
      const chat = await this.chatGateway.chat({
        orgId: input.orgId,
        projectId: input.projectId,
        correlationId: input.correlationId,
        runtimeRole: input.runtimeRole,
        userMessage: input.content,
        documentContent: context.documentContent,
        retrievalFingerprint: retrieval.trace.fingerprint,
        retrievalTraceId: retrieval.trace.id,
        onToken: (token) => {
          if (firstTokenAt === null) {
            firstTokenAt = Date.now();
          }
          try {
            this.stream.emitToken({
              conversationId: input.conversationId,
              messageId: assistantMessage.id,
              sequence: assistantSequence,
              token,
            });
          } catch {
            // Disconnect mid-stream must not cancel generation.
          }
        },
      });

      const chatLatencyMs = Date.now() - chatStarted;
      const ttftMs = firstTokenAt === null ? null : firstTokenAt - chatStarted;

      const completed = await this.messages.update(scope, assistantMessage.id, {
        content: chat.text,
        status: 'complete',
        aiExecutionId: chat.aiExecutionId,
      });

      const bindingRows = context.evidenceIds.map((evidenceId) => ({
        id: generateId(),
        messageId: completed.id,
        evidenceId,
        projectId: input.projectId,
      }));
      await this.bindings.insertMany(scope, bindingRows);

      try {
        this.stream.emitComplete({
          conversationId: input.conversationId,
          messageId: completed.id,
          sequence: assistantSequence,
          content: chat.text,
          aiExecutionId: chat.aiExecutionId,
          evidenceIds: context.evidenceIds,
          retrievalTraceId: retrieval.trace.id,
          retrievalFingerprint: retrieval.trace.fingerprint,
        });
      } catch {
        // Disconnect mid-stream must not cancel generation.
      }

      this.metrics.recordTurn({
        ttftMs,
        chatLatencyMs,
        retrievalLatencyMs,
        tokensIn: chat.tokensIn,
        tokensOut: chat.tokensOut,
        costMicros: chat.costMicros,
      });

      return {
        userMessage,
        assistantMessage: completed,
        evidenceIds: context.evidenceIds,
        retrievalTraceId: retrieval.trace.id,
        retrievalFingerprint: retrieval.trace.fingerprint,
        aiExecutionId: chat.aiExecutionId,
        inputFingerprint: chat.inputFingerprint,
        ttftMs,
        chatLatencyMs,
        retrievalLatencyMs,
      };
    } catch (error) {
      await this.messages.update(scope, assistantMessage.id, {
        status: 'failed',
        content:
          error instanceof Error ? error.message.slice(0, 500) : 'chat generation failed',
      });
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(ErrorCode.AiUnavailable, {
        module: MODULE,
        cause: error,
      });
    }
  }
}
