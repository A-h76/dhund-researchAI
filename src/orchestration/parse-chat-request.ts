import { DomainError, ErrorCode } from '../platform/errors';

const MODULE = 'orchestration';

export interface CreateConversationRequest {
  readonly title?: string;
}

export interface SendChatMessageRequest {
  readonly content: string;
}

export function parseCreateConversationRequest(body: unknown): CreateConversationRequest {
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const title = (body as { title?: unknown }).title;
  if (title === undefined) {
    return {};
  }
  if (typeof title !== 'string' || title.trim().length === 0 || title.length > 200) {
    throw new DomainError(ErrorCode.ValidationError, { module: MODULE });
  }
  return { title: title.trim() };
}

export function parseSendChatMessageRequest(body: unknown): SendChatMessageRequest {
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new DomainError(ErrorCode.ValidationError, { module: MODULE });
  }
  const content = (body as { content?: unknown }).content;
  if (typeof content !== 'string' || content.trim().length === 0 || content.length > 8_000) {
    throw new DomainError(ErrorCode.ValidationError, { module: MODULE });
  }
  return { content: content.trim() };
}
