import { Inject, Injectable } from '@nestjs/common';
import { readBearerToken } from '../iam/auth/parse-auth-request';
import { AccessContextService } from '../iam/authorization/access-context.service';
import { AccessTokenService } from '../iam/tokens/access-token.service';
import { COUNTER_SERVICE, type CounterService } from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { getCorrelationId } from '../platform/logging';
import { projectScopeFrom } from '../platform/persistence/project-scope';
import { RuntimeRole } from '../platform/runtime/role';
import {
  parseCreateConversationRequest,
  parseSendChatMessageRequest,
} from './parse-chat-request';
import { PaperChatService } from './paper-chat.service';
import { chatRateLimitKey, CHAT_RATE_LIMIT_MAX, CHAT_RATE_LIMIT_TTL_SECONDS } from './rate-limit';
import { ConversationsRepository, MessagesRepository } from './scoped-repos';

const MODULE = 'orchestration';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly accessContext: AccessContextService,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly paperChat: PaperChatService,
    @Inject(COUNTER_SERVICE) private readonly counters: CounterService,
  ) {}

  async create(authorization: string | undefined, projectId: string, body: unknown) {
    const parsed = parseCreateConversationRequest(body);
    const { userId, scope, orgId } = await this.authorize(authorization, projectId);
    await this.enforceRateLimit(orgId, userId);
    const row = await this.conversations.create(scope, {
      createdBy: userId,
      title: parsed.title,
    });
    return toConversationDto(row);
  }

  async get(authorization: string | undefined, projectId: string, conversationId: string) {
    const { scope } = await this.authorize(authorization, projectId);
    const row = await this.conversations.get(scope, conversationId);
    return toConversationDto(row);
  }

  async listMessages(
    authorization: string | undefined,
    projectId: string,
    conversationId: string,
  ) {
    const { scope } = await this.authorize(authorization, projectId);
    await this.conversations.get(scope, conversationId);
    const rows = await this.messages.listForConversation(scope, conversationId);
    return rows.map(toMessageDto);
  }

  async sendMessage(
    authorization: string | undefined,
    projectId: string,
    conversationId: string,
    body: unknown,
  ) {
    const parsed = parseSendChatMessageRequest(body);
    const { userId, scope, orgId } = await this.authorize(authorization, projectId);
    await this.enforceRateLimit(orgId, userId);
    const result = await this.paperChat.sendMessage({
      orgId,
      projectId: scope.projectId,
      conversationId,
      content: parsed.content,
      correlationId: getCorrelationId() ?? 'missing-correlation',
      runtimeRole: RuntimeRole.Api,
    });
    return {
      userMessage: toMessageDto(result.userMessage),
      assistantMessage: toMessageDto(result.assistantMessage),
      evidenceIds: result.evidenceIds,
      retrieval: {
        traceId: result.retrievalTraceId,
        fingerprint: result.retrievalFingerprint,
      },
      aiExecutionId: result.aiExecutionId,
      timings: {
        ttftMs: result.ttftMs,
        chatLatencyMs: result.chatLatencyMs,
        retrievalLatencyMs: result.retrievalLatencyMs,
      },
    };
  }

  private async authorize(authorization: string | undefined, projectId: string) {
    const user = await this.accessTokens.verify(readBearerToken(authorization));
    const context = await this.accessContext.resolve(user.sub);
    const scope = projectScopeFrom(context, projectId, MODULE);
    const membership = context.projects.find((row) => row.projectId === scope.projectId);
    if (membership === undefined) {
      throw new DomainError(ErrorCode.NotFound, { module: MODULE });
    }
    return { userId: user.sub, scope, orgId: membership.orgId };
  }

  private async enforceRateLimit(orgId: string, userId: string): Promise<void> {
    const allowed = await this.counters.incrementIfBelow(
      chatRateLimitKey(orgId, userId),
      CHAT_RATE_LIMIT_MAX,
      CHAT_RATE_LIMIT_TTL_SECONDS,
    );
    if (!allowed) {
      throw new DomainError(ErrorCode.RateLimited, {
        module: MODULE,
        details: { retryAfterSeconds: CHAT_RATE_LIMIT_TTL_SECONDS },
      });
    }
  }
}

function toConversationDto(row: {
  readonly id: string;
  readonly projectId: string;
  readonly title?: unknown;
  readonly createdBy?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    title: typeof row.title === 'string' ? row.title : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessageDto(row: {
  readonly id: string;
  readonly conversationId?: unknown;
  readonly role?: unknown;
  readonly content?: unknown;
  readonly status?: unknown;
  readonly sequence?: unknown;
  readonly aiExecutionId?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
}) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    status: row.status,
    sequence: row.sequence,
    aiExecutionId: row.aiExecutionId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
