export const CITATION_PROJECTION = Symbol('CITATION_PROJECTION');

export type CitationQuality = 'body_grounded' | 'metadata_only';

export interface CitationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly writingId: string | null;
  readonly resolvesToEvidenceId: string | null;
  readonly resolvesToSourceId: string | null;
  readonly cslJson: unknown;
  readonly qualityAnnotation: CitationQuality;
}

export interface WritingRecord {
  readonly id: string;
  readonly projectId: string;
  readonly currentVersionId: string | null;
  readonly deletedAt: Date | null;
}

export interface SentenceBindingRecord {
  readonly id: string;
  readonly writingId: string;
  readonly writingVersionId: string;
  readonly projectId: string;
  readonly sentenceHash: string;
  readonly evidenceId: string;
  readonly strength: string;
}

export interface CreateCitationInput {
  readonly id: string;
  readonly projectId: string;
  readonly writingId?: string | null;
  readonly resolvesToEvidenceId?: string | null;
  readonly resolvesToSourceId?: string | null;
  readonly cslJson: unknown;
  readonly qualityAnnotation: CitationQuality;
}

export interface CitationProjectionPort {
  createCitation(input: CreateCitationInput): Promise<CitationRecord>;
  listCitations(projectId: string): Promise<readonly CitationRecord[]>;
  findWriting(writingId: string): Promise<WritingRecord | null>;
  listBindingsForSentence(input: {
    writingId: string;
    writingVersionId: string;
    sentenceHash: string;
    projectId: string;
  }): Promise<readonly SentenceBindingRecord[]>;
}
