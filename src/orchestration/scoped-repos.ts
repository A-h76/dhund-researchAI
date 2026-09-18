import { Inject, Injectable } from '@nestjs/common';
import {
  SCOPED_STORE,
  type ProjectScope,
  type ScopedListQuery,
  type ScopedRow,
  type ScopedStore,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId } from '../platform/ids/uuid-v7';
import { ScopedReader } from '../platform/persistence/scoped-reader';

const MODULE = 'orchestration';

export type MessageRoleValue = 'user' | 'assistant' | 'system';
export type MessageStatusValue =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'failed'
  | 'cancelled';

@Injectable()
export class ResearchRunsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('research_run', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('research_run', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('research_run', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('research_run', scope, query);
  }
}

@Injectable()
export class ExtractionCellsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('extraction_cell', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('extraction_cell', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('extraction_cell', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('extraction_cell', scope, query);
  }
}

@Injectable()
export class ConversationsRepository {
  constructor(
    private readonly reader: ScopedReader,
    @Inject(SCOPED_STORE) private readonly store: ScopedStore,
  ) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('conversation', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('conversation', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('conversation', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('conversation', scope, query);
  }

  create(
    scope: ProjectScope,
    input: { readonly createdBy: string; readonly title?: string | null },
  ): Promise<ScopedRow> {
    return this.store.insert('conversation', scope, {
      id: generateId(),
      createdBy: input.createdBy,
      ...(input.title !== undefined && input.title !== null ? { title: input.title } : {}),
    });
  }
}

@Injectable()
export class MessagesRepository {
  constructor(
    private readonly reader: ScopedReader,
    @Inject(SCOPED_STORE) private readonly store: ScopedStore,
  ) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('message', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('message', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('message', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('message', scope, query);
  }

  async listForConversation(
    scope: ProjectScope,
    conversationId: string,
  ): Promise<readonly ScopedRow[]> {
    const rows = await this.reader.list('message', scope, { limit: 500 });
    return rows
      .filter((row) => row.conversationId === conversationId)
      .sort((a, b) => Number(a.sequence) - Number(b.sequence));
  }

  async nextSequence(scope: ProjectScope, conversationId: string): Promise<number> {
    const rows = await this.listForConversation(scope, conversationId);
    let max = 0;
    for (const row of rows) {
      const sequence = Number(row.sequence);
      if (Number.isFinite(sequence) && sequence > max) {
        max = sequence;
      }
    }
    return max + 1;
  }

  async create(
    scope: ProjectScope,
    input: {
      readonly conversationId: string;
      readonly role: MessageRoleValue;
      readonly content: string;
      readonly status: MessageStatusValue;
      readonly sequence: number;
      readonly aiExecutionId?: string | null;
    },
  ): Promise<ScopedRow> {
    try {
      return await this.store.insert('message', scope, {
        id: generateId(),
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        status: input.status,
        sequence: input.sequence,
        ...(typeof input.aiExecutionId === 'string'
          ? { aiExecutionId: input.aiExecutionId }
          : {}),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError(ErrorCode.AlreadyExists, {
          module: MODULE,
          userMessage: 'Message sequence collision.',
        });
      }
      throw error;
    }
  }
}

@Injectable()
export class ResearchArtifactsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('research_artifact', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('research_artifact', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('research_artifact', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('research_artifact', scope, query);
  }
}

@Injectable()
export class ScreeningDecisionsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('screening_decision', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('screening_decision', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('screening_decision', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('screening_decision', scope, query);
  }
}

export const ORCHESTRATION_REPOS = [
  ResearchRunsRepository,
  ExtractionCellsRepository,
  ConversationsRepository,
  MessagesRepository,
  ResearchArtifactsRepository,
  ScreeningDecisionsRepository,
] as const;

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (current === undefined || current === null) {
      return false;
    }
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (code === 'P2002' || code === '23505') {
        return true;
      }
    }
    const message = current instanceof Error ? current.message : String(current);
    if (/23505|unique constraint|duplicate key/i.test(message)) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
