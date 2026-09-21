import { Inject, Injectable } from '@nestjs/common';
import type { IdentityLookupStore } from '../l0/ports/identity-lookup.port';
import { IDENTITY_LOOKUP } from '../l0/ports/tokens';
import {
  IDENTITY_SPINE_STORE,
  type IdentifierSchemeValue,
  type IdentitySpineStore,
  type MergeCandidateSpineRecord,
  type MergeMatchTypeValue,
} from '../l0/ports/identity-spine.port';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId } from '../platform/ids';
import { normalizeDoi } from '../ingestion/parse-upload-request';
import {
  hashAuthors,
  normalizeArxivIdentifier,
  normalizePmid,
} from './identity-normalize';
import { IdentityMetrics } from './identity.metrics';

const MODULE = 'identity';

export interface IdentityResolveJobPayload {
  readonly orgId: string;
  readonly correlationId: string;
  readonly identifier: {
    readonly scheme: IdentifierSchemeValue;
    readonly value: string;
  };
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly year?: number;
  readonly workType?: 'article' | 'preprint' | 'chapter' | 'book';
  /** When set, link this project document after resolve (never returned cross-project). */
  readonly documentId?: string;
  /** When set, link this project external record after resolve. */
  readonly externalRecordId?: string;
  /**
   * Optional existing candidate work. When DOI exact matches a *different* work,
   * a pending exact_doi MergeCandidate is created for audited approval — never
   * an automatic merge.
   */
  readonly candidateWorkId?: string;
}

/**
 * Resolve result is intentionally project-blind (E-4): only global work ids and
 * merge-candidate ids. No project membership, documents, or evidence.
 */
export interface IdentityResolveResult {
  readonly outcome: 'linked' | 'created' | 'merge_candidate' | 'unchanged';
  readonly canonicalWorkId: string;
  readonly matchType?: MergeMatchTypeValue;
  readonly mergeCandidateIds: readonly string[];
}

@Injectable()
export class IdentityResolveService {
  constructor(
    @Inject(IDENTITY_SPINE_STORE) private readonly spine: IdentitySpineStore,
    @Inject(IDENTITY_LOOKUP) private readonly trigram: IdentityLookupStore,
    private readonly metrics: IdentityMetrics,
  ) {}

  async execute(payload: IdentityResolveJobPayload): Promise<IdentityResolveResult> {
    const normalized = normalizeIdentifier(payload.identifier.scheme, payload.identifier.value);
    if (normalized === null) {
      throw new DomainError(ErrorCode.ValidationError, { module: MODULE });
    }

    const existing = await this.spine.findWorkByIdentifier(normalized.scheme, normalized.value);

    if (existing !== null) {
      if (
        payload.candidateWorkId !== undefined &&
        payload.candidateWorkId !== existing.id
      ) {
        const merge = await this.proposeExact(
          payload.candidateWorkId,
          existing.id,
          normalized.scheme === 'doi' ? 'exact_doi' : 'corroborated_pmid_arxiv',
          { scheme: normalized.scheme, value: normalized.value },
        );
        await this.linkCaller(payload, existing.id);
        this.metrics.recordResolveLinked();
        return {
          outcome: 'merge_candidate',
          canonicalWorkId: existing.id,
          matchType: merge?.matchType,
          mergeCandidateIds: merge === null ? [] : [merge.id],
        };
      }

      await this.linkCaller(payload, existing.id);
      const fuzzyIds = await this.proposeFuzzyIfTitle(existing.id, payload.title);
      this.metrics.recordResolveLinked();
      return {
        outcome: 'linked',
        canonicalWorkId: existing.id,
        mergeCandidateIds: fuzzyIds,
      };
    }

    const title = payload.title?.trim() || normalized.value;
    const authors = payload.authors ?? [];
    const work = await this.spine.createWork({
      id: generateId(),
      canonicalTitle: title,
      authorHash: hashAuthors(authors),
      year: payload.year ?? null,
      type: payload.workType ?? 'article',
    });
    await this.spine.attachIdentifier({
      id: generateId(),
      canonicalWorkId: work.id,
      scheme: normalized.scheme,
      value: normalized.value,
    });
    await this.linkCaller(payload, work.id);
    const fuzzyIds = await this.proposeFuzzyIfTitle(work.id, title);
    this.metrics.recordResolveCreated();
    return {
      outcome: 'created',
      canonicalWorkId: work.id,
      mergeCandidateIds: fuzzyIds,
    };
  }

  private async proposeExact(
    candidateWorkId: string,
    existingWorkId: string,
    matchType: 'exact_doi' | 'corroborated_pmid_arxiv',
    evidence: Readonly<Record<string, unknown>>,
  ): Promise<MergeCandidateSpineRecord | null> {
    const row = await this.spine.createMergeCandidate({
      id: generateId(),
      candidateWorkId,
      existingWorkId,
      matchType,
      evidence,
    });
    if (row !== null) {
      this.metrics.recordMergeCandidate(matchType);
    }
    return row;
  }

  private async proposeFuzzyIfTitle(
    candidateWorkId: string,
    title: string | undefined,
  ): Promise<readonly string[]> {
    if (title === undefined || title.trim().length === 0) {
      return [];
    }
    // E-2: trigram propose inserts pending fuzzy_title only — never merges.
    const proposed = await this.trigram.proposeMergeCandidatesByTitle({
      candidateWorkId,
      title: title.trim(),
      limit: 5,
      allocateId: () => generateId(),
    });
    for (const row of proposed) {
      this.metrics.recordMergeCandidate(row.matchType);
    }
    return proposed.map((row) => row.id);
  }

  private async linkCaller(
    payload: IdentityResolveJobPayload,
    canonicalWorkId: string,
  ): Promise<void> {
    if (payload.documentId !== undefined) {
      await this.spine.linkDocumentToWork(payload.documentId, canonicalWorkId);
    }
    if (payload.externalRecordId !== undefined) {
      await this.spine.linkExternalRecordToWork(payload.externalRecordId, canonicalWorkId);
    }
  }
}

export function normalizeIdentifier(
  scheme: IdentifierSchemeValue,
  value: string,
): { scheme: IdentifierSchemeValue; value: string } | null {
  switch (scheme) {
    case 'doi': {
      const doi = normalizeDoi(value);
      return doi === null ? null : { scheme: 'doi', value: doi };
    }
    case 'pmid': {
      const pmid = normalizePmid(value);
      return pmid === null ? null : { scheme: 'pmid', value: pmid };
    }
    case 'arxiv': {
      const arxiv = normalizeArxivIdentifier(value);
      return arxiv === null ? null : { scheme: 'arxiv', value: arxiv };
    }
    case 'isbn':
    case 's2_id': {
      const trimmed = value.trim().toLowerCase();
      return trimmed.length === 0 ? null : { scheme, value: trimmed };
    }
    default: {
      const exhaustive: never = scheme;
      return exhaustive;
    }
  }
}
