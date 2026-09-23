import { Inject, Injectable } from '@nestjs/common';
import { L0OperationError } from '../l0/ports/errors';
import {
  WRITING_STORE,
  type StoredWriting,
  type StoredWritingBinding,
  type StoredWritingVersion,
  type WritingEvidenceLink,
  type WritingStore,
} from '../l0/ports/writing-store.port';
import { DomainError, ErrorCode, notFound } from '../platform/errors';
import { generateId } from '../platform/ids/uuid-v7';
import { CitationMetrics } from './citations.metrics';

const MODULE = 'evidence';

@Injectable()
export class WritingPersistenceService {
  constructor(
    @Inject(WRITING_STORE) private readonly store: WritingStore,
    private readonly metrics: CitationMetrics,
  ) {}

  createWriting(input: {
    projectId: string;
    title: string;
    createdBy: string;
  }): Promise<StoredWriting> {
    return this.store.insertWriting({
      id: generateId(),
      projectId: input.projectId,
      title: input.title,
      createdBy: input.createdBy,
    });
  }

  async appendVersion(input: {
    projectId: string;
    writingId: string;
    contentRef: string;
    createdBy: string;
  }): Promise<StoredWritingVersion> {
    const writing = await this.requireWriting(input.projectId, input.writingId);
    const versions = await this.store.listVersions(writing.id);
    const versionNo =
      versions.reduce((max, row) => Math.max(max, row.versionNo), 0) + 1;
    return this.store.insertVersion({
      id: generateId(),
      writingId: writing.id,
      versionNo,
      contentRef: input.contentRef,
      createdBy: input.createdBy,
    });
  }

  /**
   * GAP-WRITING-01: a writing_versions row is insert-only.
   * The database trigger is the backstop; this refuses the mutation in the API layer.
   */
  async updateVersion(): Promise<never> {
    throw new DomainError(ErrorCode.InvalidStateTransition, {
      module: MODULE,
      userMessage: 'Writing versions are immutable.',
    });
  }

  async bindSentence(input: {
    projectId: string;
    writingId: string;
    writingVersionId: string;
    sentenceHash: string;
    evidenceId: string;
    strength: string;
  }): Promise<StoredWritingBinding> {
    const writing = await this.requireWriting(input.projectId, input.writingId);
    const versions = await this.store.listVersions(writing.id);
    if (!versions.some((row) => row.id === input.writingVersionId)) {
      throw notFound({ module: MODULE });
    }
    const live = await this.resolveLive(input.evidenceId, writing.projectId);
    if (live === null) {
      this.metrics.recordBindingResolutionFailure();
      throw notFound({ module: MODULE });
    }
    if (await this.store.messageBindingExists(writing.projectId, input.evidenceId)) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'Writing and message evidence bindings are disjoint.',
      });
    }
    try {
      return await this.store.insertBinding({
        id: generateId(),
        writingId: writing.id,
        writingVersionId: input.writingVersionId,
        projectId: writing.projectId,
        sentenceHash: input.sentenceHash,
        evidenceId: input.evidenceId,
        strength: input.strength,
      });
    } catch (error) {
      if (
        error instanceof L0OperationError &&
        error.message.includes('disjoint')
      ) {
        throw new DomainError(ErrorCode.ValidationError, {
          module: MODULE,
          userMessage: 'Writing and message evidence bindings are disjoint.',
        });
      }
      throw error;
    }
  }

  async listBindings(
    projectId: string,
    writingVersionId: string,
  ): Promise<readonly StoredWritingBinding[]> {
    const bindings = await this.store.listBindings(writingVersionId);
    return bindings.filter((row) => row.projectId === projectId);
  }

  async resolveBinding(
    projectId: string,
    binding: StoredWritingBinding,
  ): Promise<WritingEvidenceLink | null> {
    if (binding.projectId !== projectId) {
      this.metrics.recordBindingResolutionFailure();
      return null;
    }
    const live = await this.resolveLive(binding.evidenceId, projectId);
    if (live === null) {
      this.metrics.recordBindingResolutionFailure();
    }
    return live;
  }

  private async requireWriting(projectId: string, writingId: string): Promise<StoredWriting> {
    const writing = await this.store.findWriting(writingId);
    if (writing === null || writing.projectId !== projectId || writing.deletedAt !== null) {
      throw notFound({ module: MODULE });
    }
    return writing;
  }

  private async resolveLive(
    evidenceId: string,
    projectId: string,
  ): Promise<WritingEvidenceLink | null> {
    const seen = new Set<string>();
    let currentId: string | null = evidenceId;
    let live: WritingEvidenceLink | null = null;
    while (currentId !== null) {
      if (seen.has(currentId)) {
        return null;
      }
      seen.add(currentId);
      const row = await this.store.findEvidence(currentId);
      if (row === null || row.projectId !== projectId) {
        return null;
      }
      live = row;
      currentId = row.supersededById;
    }
    return live;
  }
}
