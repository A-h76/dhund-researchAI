export const EVIDENCE_SPINE = Symbol('EVIDENCE_SPINE');

export type EvidenceTypeKind = 'body_grounded' | 'metadata_only';

export type StoredEvidenceStance = 'supports' | 'contradicts' | 'neutral' | 'unresolved';

export interface EvidenceLocatorValue {
  readonly documentVersionId: string;
  readonly blockId: string;
  readonly page: number;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly chunkId: string | null;
  readonly locator: EvidenceLocatorValue;
  readonly text: string;
  readonly stance: StoredEvidenceStance;
  readonly extractionMethod: 'llm' | 'deterministic' | 'human';
  readonly aiExecutionId: string | null;
  readonly type: EvidenceTypeKind;
}

export interface SourceRecord {
  readonly id: string;
  readonly projectId: string;
  readonly documentId: string | null;
  readonly type: 'document' | 'external_record';
}

export interface ChunkRecord {
  readonly id: string;
  readonly projectId: string;
  readonly documentVersionId: string;
  readonly text: string;
  readonly blockIds: readonly string[];
}

export interface ClaimRecord {
  readonly id: string;
  readonly projectId: string;
  readonly text: string;
}

export interface EvidenceClaimLinkRecord {
  readonly id: string;
  readonly evidenceId: string;
  readonly claimId: string;
  readonly stance: StoredEvidenceStance;
}

export interface PersistExtractedEvidenceInput {
  readonly id: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly chunkId: string | null;
  readonly locator: EvidenceLocatorValue;
  readonly text: string;
  readonly type: EvidenceTypeKind;
  readonly aiExecutionId: string;
}

export interface ExtractionSetRecord {
  readonly stepId: string;
  readonly runId: string;
  readonly inputFingerprint: string;
  readonly aiExecutionId: string;
  readonly evidenceIds: readonly string[];
  readonly omittedLocatorCount: number;
}

export interface StanceLabelRecord {
  readonly runId: string;
  readonly evidenceId: string;
  readonly stance: StoredEvidenceStance;
  readonly aiExecutionId: string;
  readonly claimId: string | null;
}

export interface EvidenceSpinePort {
  findSource(sourceId: string): Promise<SourceRecord | null>;
  findChunkInProject(chunkId: string, projectId: string): Promise<ChunkRecord | null>;
  findChunkForBlock(input: {
    projectId: string;
    documentVersionId: string;
    blockId: string;
  }): Promise<ChunkRecord | null>;
  findClaim(claimId: string, projectId: string): Promise<ClaimRecord | null>;
  findEvidence(evidenceId: string, projectId: string): Promise<EvidenceRecord | null>;
  listEvidenceForExecution(aiExecutionId: string): Promise<readonly EvidenceRecord[]>;
  findExtractionSet(stepId: string): Promise<ExtractionSetRecord | null>;
  persistExtractionSet(input: {
    stepId: string;
    runId: string;
    inputFingerprint: string;
    correlationId: string;
    aiExecutionId: string;
    omittedLocatorCount: number;
    evidence: readonly PersistExtractedEvidenceInput[];
  }): Promise<ExtractionSetRecord>;
  findStanceLabel(runId: string, evidenceId: string): Promise<StanceLabelRecord | null>;
  persistStanceLabel(input: {
    outboxId: string;
    runId: string;
    evidenceId: string;
    projectId: string;
    stance: StoredEvidenceStance;
    aiExecutionId: string;
    claimId: string | null;
    claimLinkId: string | null;
    correlationId: string;
  }): Promise<StanceLabelRecord>;
  listClaimLinks(claimId: string): Promise<readonly EvidenceClaimLinkRecord[]>;
}
