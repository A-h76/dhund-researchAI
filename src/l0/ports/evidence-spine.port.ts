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

export type GenerationMethod = 'llm' | 'deterministic' | 'human';

export type ClaimSupportStatus = 'unsupported' | 'supported' | 'conflicting';

export interface ClaimRecord {
  readonly id: string;
  readonly projectId: string;
  readonly text: string;
  readonly method: GenerationMethod;
  readonly aiExecutionId: string | null;
  readonly coverageAnnotation: Readonly<Record<string, unknown>>;
}

export interface ArgumentRecord {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly structure: unknown;
  readonly method: GenerationMethod;
  readonly aiExecutionId: string | null;
}

export interface ArgumentClaimLinkRecord {
  readonly id: string;
  readonly argumentId: string;
  readonly claimId: string;
  readonly projectId: string;
  readonly role: string | null;
  readonly ordinal: number | null;
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
  createClaim(input: {
    id: string;
    projectId: string;
    text: string;
    coverageAnnotation: Readonly<Record<string, unknown>>;
  }): Promise<ClaimRecord>;
  createArgument(input: {
    id: string;
    projectId: string;
    title: string;
    structure: unknown;
  }): Promise<ArgumentRecord>;
  findArgument(argumentId: string, projectId: string): Promise<ArgumentRecord | null>;
  countArgumentLinksForClaim(claimId: string): Promise<number>;
  countEvidenceLinksForClaim(claimId: string): Promise<number>;
  softDeleteClaim(claimId: string, projectId: string): Promise<boolean>;
  linkArgumentClaim(input: {
    id: string;
    argumentId: string;
    claimId: string;
    projectId: string;
    role: string | null;
    ordinal: number | null;
  }): Promise<ArgumentClaimLinkRecord>;
  linkEvidenceClaim(input: {
    id: string;
    evidenceId: string;
    claimId: string;
    stance: StoredEvidenceStance;
    weight: string;
  }): Promise<EvidenceClaimLinkRecord>;
  listArgumentClaims(argumentId: string): Promise<readonly ArgumentClaimLinkRecord[]>;
  listArgumentsForClaim(claimId: string): Promise<readonly ArgumentClaimLinkRecord[]>;
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
