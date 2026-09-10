import { Inject, Injectable } from '@nestjs/common';
import {
  CHUNK_STORE,
  EXTRACT_STORE,
  SCOPED_STORE,
  type ChunkStore,
  type DocumentBodyCapability,
  type ExtractStore,
  type ProjectScope,
  type ScopedListQuery,
  type ScopedRow,
  type ScopedStore,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId, isUuid } from '../platform/ids/uuid-v7';
import { ScopedReader } from '../platform/persistence/scoped-reader';
import type { EvidenceTypeValue, ExtractionMethodValue } from './evidence.metrics';
import { EvidenceMetrics } from './evidence.metrics';
import {
  isNonEmptyLocatorObject,
  locatorPointsAtBlock,
  parseStructureLocator,
  quotedTextMatches,
  type LocatorRejectionReason,
} from './locator';
import { retainAsUntrustedContent } from './untrusted-content';

const MODULE = 'evidence';

export type EvidenceStanceValue =
  | 'supports'
  | 'contradicts'
  | 'neutral'
  | 'unresolved';

export interface CreateEvidenceInput {
  readonly sourceId: string;
  readonly type: EvidenceTypeValue;
  readonly extractionMethod: ExtractionMethodValue;
  readonly text: string;
  readonly locator: unknown;
  readonly chunkId?: string | null;
  readonly aiExecutionId?: string | null;
  readonly stance?: EvidenceStanceValue;
  readonly qualityScore: number;
  readonly polarity?: number | null;
}

export interface AdmitModelEvidenceInput extends CreateEvidenceInput {
  readonly extractionMethod: 'llm';
  readonly aiExecutionId: string;
}

@Injectable()
export class EvidenceRepository {
  constructor(
    private readonly reader: ScopedReader,
    @Inject(SCOPED_STORE) private readonly store: ScopedStore,
    @Inject(CHUNK_STORE) private readonly chunks: ChunkStore,
    @Inject(EXTRACT_STORE) private readonly extract: ExtractStore,
    private readonly metrics: EvidenceMetrics,
  ) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('evidence', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('evidence', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('evidence', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('evidence', scope, query);
  }

  /**
   * LLM output that omits a locator produces no row. Other locator failures
   * still throw so a dangling locator is visible rather than silent.
   */
  async admitModel(
    scope: ProjectScope,
    input: AdmitModelEvidenceInput,
  ): Promise<ScopedRow | null> {
    if (!isNonEmptyLocatorObject(input.locator)) {
      this.metrics.recordRejection('missing_locator');
      return null;
    }
    return this.create(scope, input);
  }

  async supersede(
    scope: ProjectScope,
    previousId: string,
    input: CreateEvidenceInput,
  ): Promise<{ readonly previous: ScopedRow; readonly current: ScopedRow }> {
    await this.reader.require('evidence', scope, previousId, MODULE);
    const current = await this.create(scope, input);
    const updated = await this.reader.update(
      'evidence',
      scope,
      previousId,
      { supersededById: current.id },
      MODULE,
    );
    return { previous: updated, current };
  }

  async create(scope: ProjectScope, input: CreateEvidenceInput): Promise<ScopedRow> {
    const text = retainAsUntrustedContent(input.text);
    if (text.trim().length === 0) {
      this.fail('quote_mismatch');
    }
    if (typeof input.qualityScore !== 'number' || !Number.isFinite(input.qualityScore)) {
      throw invalid();
    }
    if (
      input.polarity !== undefined &&
      input.polarity !== null &&
      input.polarity !== -1 &&
      input.polarity !== 0 &&
      input.polarity !== 1
    ) {
      throw invalid();
    }

    switch (input.extractionMethod) {
      case 'llm': {
        if (typeof input.aiExecutionId !== 'string' || !isUuid(input.aiExecutionId)) {
          this.fail('llm_without_execution');
        }
        break;
      }
      case 'deterministic':
      case 'human':
        break;
      default: {
        const exhaustive: never = input.extractionMethod;
        throw new DomainError(ErrorCode.ValidationError, {
          module: MODULE,
          serverDetail: String(exhaustive),
        });
      }
    }

    const source = await this.reader.require('source', scope, input.sourceId, MODULE);
    const sourceDocumentId =
      typeof source.documentId === 'string' ? source.documentId : null;

    let storedLocator: Record<string, unknown>;
    let chunkId: string | null = input.chunkId ?? null;

    switch (input.type) {
      case 'body_grounded': {
        storedLocator = await this.validateBodyGrounded(
          scope,
          input,
          sourceDocumentId,
        );
        chunkId = input.chunkId ?? null;
        break;
      }
      case 'metadata_only': {
        storedLocator = await this.validateMetadataOnly(
          scope,
          input,
          sourceDocumentId,
        );
        break;
      }
      default: {
        const exhaustive: never = input.type;
        throw new DomainError(ErrorCode.ValidationError, {
          module: MODULE,
          serverDetail: String(exhaustive),
        });
      }
    }

    const row = await this.store.insert('evidence', scope, {
      id: generateId(),
      sourceId: input.sourceId,
      ...(chunkId === null ? {} : { chunkId }),
      locator: storedLocator,
      text,
      stance: input.stance ?? 'unresolved',
      ...(input.polarity === undefined || input.polarity === null
        ? {}
        : { polarity: input.polarity }),
      qualityScore: input.qualityScore,
      extractionMethod: input.extractionMethod,
      ...(typeof input.aiExecutionId === 'string' && isUuid(input.aiExecutionId)
        ? { aiExecutionId: input.aiExecutionId }
        : {}),
      type: input.type,
    });
    this.metrics.recordCreated(input.type, input.extractionMethod);
    return row;
  }

  private async validateBodyGrounded(
    scope: ProjectScope,
    input: CreateEvidenceInput,
    sourceDocumentId: string | null,
  ): Promise<Record<string, unknown>> {
    if (sourceDocumentId === null) {
      this.fail('forbidden_body');
    }
    const capability = await this.bodyRights(sourceDocumentId);
    if (capability === 'forbidden') {
      this.fail('metadata_masquerade');
    }

    const chunkId = input.chunkId ?? null;
    if (typeof chunkId !== 'string' || !isUuid(chunkId)) {
      this.fail('body_grounded_without_chunk');
    }

    const locator = parseStructureLocator(input.locator);
    if (locator === null) {
      this.fail('missing_locator');
    }

    const chunk = await this.chunks.findInProject(scope, chunkId);
    if (chunk === null) {
      this.fail('cross_project_chunk');
    }
    if (chunk.documentId !== sourceDocumentId) {
      this.fail('cross_project_chunk');
    }
    if (chunk.documentVersionId !== locator.documentVersionId) {
      this.fail('unresolved_locator');
    }
    if (!chunk.blockIds.includes(locator.blockId)) {
      this.fail('unresolved_locator');
    }

    const block = await this.extract.findBlock(locator.blockId);
    const resolution = locatorPointsAtBlock(locator, block);
    switch (resolution) {
      case 'ok':
        break;
      case 'page_mismatch':
        this.fail('page_mismatch');
        break;
      case 'unresolved':
        this.fail('unresolved_locator');
        break;
      default: {
        const exhaustive: never = resolution;
        throw new DomainError(ErrorCode.ValidationError, {
          module: MODULE,
          serverDetail: String(exhaustive),
        });
      }
    }

    if (!quotedTextMatches(input.text, chunk.text)) {
      this.fail('quote_mismatch');
    }

    return {
      blockId: locator.blockId,
      documentVersionId: locator.documentVersionId,
      page: locator.page,
    };
  }

  private async validateMetadataOnly(
    scope: ProjectScope,
    input: CreateEvidenceInput,
    sourceDocumentId: string | null,
  ): Promise<Record<string, unknown>> {
    if (!isNonEmptyLocatorObject(input.locator)) {
      this.fail('missing_locator');
    }

    const capability =
      sourceDocumentId === null ? 'unrestricted' : await this.bodyRights(sourceDocumentId);

    const chunkId = input.chunkId ?? null;
    if (chunkId !== null && chunkId !== '') {
      if (capability === 'forbidden') {
        this.fail('metadata_masquerade');
      }
      if (!isUuid(chunkId)) {
        this.fail('cross_project_chunk');
      }
      if ((await this.chunks.findInProject(scope, chunkId)) === null) {
        this.fail('cross_project_chunk');
      }
    }

    return input.locator;
  }

  private async bodyRights(documentId: string): Promise<DocumentBodyCapability> {
    const capability = await this.extract.bodyCapability(documentId);
    return capability ?? 'forbidden';
  }

  private fail(reason: LocatorRejectionReason): never {
    this.metrics.recordRejection(reason);
    throw invalid();
  }
}

function invalid(): DomainError {
  return new DomainError(ErrorCode.ValidationError, { module: MODULE });
}
