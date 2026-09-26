import { Inject, Injectable } from '@nestjs/common';
import {
  CITATION_PROJECTION,
  type CitationProjectionPort,
  type CitationQuality,
  type CitationRecord,
} from '../l0/ports/citation-projection.port';
import { EVIDENCE_SPINE, type EvidenceSpinePort } from '../l0/ports/evidence-spine.port';
import { L0OperationError } from '../l0/ports/errors';
import { DomainError } from '../platform/errors/domain-error';
import { ErrorCode } from '../platform/errors/error-codes';
import { generateId } from '../platform/ids/uuid-v7';

export interface CreateCitationInput {
  readonly projectId: string;
  readonly writingId?: string;
  readonly resolvesToEvidenceId?: string;
  readonly resolvesToSourceId?: string;
  readonly cslJson: unknown;
  readonly qualityAnnotation: CitationQuality;
}

@Injectable()
export class CitationsService {
  constructor(
    @Inject(CITATION_PROJECTION) private readonly store: CitationProjectionPort,
    @Inject(EVIDENCE_SPINE) private readonly spine: EvidenceSpinePort,
  ) {}

  async create(input: CreateCitationInput): Promise<CitationRecord> {
    const evidenceId = input.resolvesToEvidenceId ?? null;
    const sourceId = input.resolvesToSourceId ?? null;
    const targetCount = (evidenceId === null ? 0 : 1) + (sourceId === null ? 0 : 1);
    if (targetCount !== 1) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: 'evidence',
        userMessage: 'A citation must resolve to exactly one of evidence or source.',
      });
    }

    if (evidenceId !== null) {
      const evidence = await this.spine.findEvidence(evidenceId, input.projectId);
      if (evidence === null) {
        throw new DomainError(ErrorCode.ValidationError, {
          module: 'evidence',
          userMessage: 'Citation evidence target is unknown or out of project.',
        });
      }
    } else if (sourceId !== null) {
      const source = await this.spine.findSource(sourceId);
      if (source === null || source.projectId !== input.projectId) {
        throw new DomainError(ErrorCode.ValidationError, {
          module: 'evidence',
          userMessage: 'Citation source target is unknown or out of project.',
        });
      }
    }

    if (input.writingId !== undefined) {
      const writing = await this.store.findWriting(input.writingId);
      if (writing === null || writing.projectId !== input.projectId) {
        throw new DomainError(ErrorCode.ValidationError, {
          module: 'evidence',
          userMessage: 'Citation writing is unknown or out of project.',
        });
      }
    }

    try {
      return await this.store.createCitation({
        id: generateId(),
        projectId: input.projectId,
        writingId: input.writingId ?? null,
        resolvesToEvidenceId: evidenceId,
        resolvesToSourceId: sourceId,
        cslJson: input.cslJson,
        qualityAnnotation: input.qualityAnnotation,
      });
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw new DomainError(ErrorCode.ValidationError, {
          module: 'evidence',
          cause: error,
          userMessage: 'A citation must resolve to exactly one of evidence or source.',
        });
      }
      throw error;
    }
  }
}
