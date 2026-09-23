import { ClaimsGraphService } from '../../src/evidence/claims-graph.service';
import { ClaimsMetrics } from '../../src/evidence/claims.metrics';
import type {
  ArgumentClaimLinkRecord,
  ArgumentRecord,
  ClaimRecord,
  EvidenceClaimLinkRecord,
  EvidenceRecord,
  EvidenceSpinePort,
  ExtractionSetRecord,
  StanceLabelRecord,
} from '../../src/l0/ports/evidence-spine.port';
import { DomainError } from '../../src/platform/errors/domain-error';
import { ErrorCode, httpStatusFor } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

describe('DHB-60 claims graph (scoped repository)', () => {
  const projectId = generateId();
  const otherProjectId = generateId();

  function logger() {
    return {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger;
  }

  it('stores generated claims with aiExecutionId and deterministic claims without', async () => {
    const spine = new GraphSpine();
    const service = new ClaimsGraphService(spine, new ClaimsMetrics(), logger());
    const generated = await service.createClaim({
      projectId,
      text: 'Treatment reduces events',
      method: 'llm',
      aiExecutionId: generateId(),
    });
    expect(generated.aiExecutionId).toEqual(expect.any(String));
    expect(generated.method).toBe('llm');

    const deterministic = await service.createClaim({
      projectId,
      text: 'Background definition',
      method: 'deterministic',
    });
    expect(deterministic.method).toBe('deterministic');
    expect(deterministic.aiExecutionId).toBeNull();
  });

  it('rejects generated claims that omit aiExecutionId', async () => {
    const service = new ClaimsGraphService(new GraphSpine(), new ClaimsMetrics(), logger());
    await expect(
      service.createClaim({
        projectId,
        text: 'Generated without provenance',
        method: 'llm',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
  });

  it('stores an unsupported claim and does not present it as supported', async () => {
    const spine = new GraphSpine();
    const service = new ClaimsGraphService(spine, new ClaimsMetrics(), logger());
    const claim = await service.createClaim({
      projectId,
      text: 'Open question',
      method: 'deterministic',
    });
    const view = await service.getClaim(projectId, claim.id);
    expect(view.supportStatus).toBe('unsupported');
    expect(view.evidenceLinks).toEqual([]);
  });

  it('lets supporting and contradicting evidence coexist on one claim', async () => {
    const spine = new GraphSpine();
    const service = new ClaimsGraphService(spine, new ClaimsMetrics(), logger());
    const claim = await service.createClaim({
      projectId,
      text: 'Treatment reduces events',
      method: 'deterministic',
    });
    const support = spine.addEvidence(projectId);
    const contradict = spine.addEvidence(projectId);
    await service.linkEvidenceToClaim({
      projectId,
      evidenceId: support.id,
      claimId: claim.id,
      stance: 'supports',
    });
    await service.linkEvidenceToClaim({
      projectId,
      evidenceId: contradict.id,
      claimId: claim.id,
      stance: 'contradicts',
    });
    const view = await service.getClaim(projectId, claim.id);
    expect(view.supportStatus).toBe('conflicting');
    expect(view.evidenceLinks.map((link) => link.stance).sort()).toEqual([
      'contradicts',
      'supports',
    ]);
  });

  it('rejects a cross-project evidenceId', async () => {
    const spine = new GraphSpine();
    const service = new ClaimsGraphService(spine, new ClaimsMetrics(), logger());
    const claim = await service.createClaim({
      projectId,
      text: 'Claim',
      method: 'deterministic',
    });
    const foreign = spine.addEvidence(otherProjectId);
    await expect(
      service.linkEvidenceToClaim({
        projectId,
        evidenceId: foreign.id,
        claimId: claim.id,
        stance: 'supports',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
  });

  it('reaches argument claims via argument_claim_links, not JSONB', async () => {
    const spine = new GraphSpine();
    const service = new ClaimsGraphService(spine, new ClaimsMetrics(), logger());
    const claim = await service.createClaim({
      projectId,
      text: 'Linked claim',
      method: 'deterministic',
    });
    const orphan = generateId();
    const argument = await service.createArgument({
      projectId,
      title: 'Thesis',
      method: 'deterministic',
      structure: { claimIds: [claim.id, orphan] },
    });
    await service.linkClaimToArgument({
      projectId,
      argumentId: argument.id,
      claimId: claim.id,
    });
    const listed = await service.listClaimsForArgument(projectId, argument.id);
    expect(listed.relationalClaimIds).toEqual([claim.id]);
    expect(listed.jsonbOnlyClaimIds).toEqual([orphan]);
    expect(listed.reachabilityPasses).toBe(false);
  });

  it('returns 409 when deleting a claim linked to an argument, and the claim survives', async () => {
    const spine = new GraphSpine();
    const service = new ClaimsGraphService(spine, new ClaimsMetrics(), logger());
    const claim = await service.createClaim({
      projectId,
      text: 'Linked claim',
      method: 'deterministic',
    });
    const argument = await service.createArgument({
      projectId,
      title: 'Thesis',
      method: 'deterministic',
    });
    await service.linkClaimToArgument({
      projectId,
      argumentId: argument.id,
      claimId: claim.id,
    });

    try {
      await service.deleteClaim(projectId, claim.id);
      throw new Error('expected 409');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(ErrorCode.InvalidStateTransition);
      expect(httpStatusFor((error as DomainError).code)).toBe(409);
    }

    const surviving = await service.getClaim(projectId, claim.id);
    expect(surviving.claim.id).toBe(claim.id);
  });
});

class GraphSpine implements EvidenceSpinePort {
  readonly claims = new Map<string, ClaimRecord>();
  readonly arguments = new Map<string, ArgumentRecord>();
  readonly evidence = new Map<string, EvidenceRecord>();
  readonly argumentLinks: ArgumentClaimLinkRecord[] = [];
  readonly evidenceLinks: EvidenceClaimLinkRecord[] = [];

  addEvidence(projectId: string): EvidenceRecord {
    const row: EvidenceRecord = {
      id: generateId(),
      projectId,
      sourceId: generateId(),
      chunkId: generateId(),
      locator: { documentVersionId: generateId(), blockId: generateId(), page: 1 },
      text: 'quote',
      stance: 'unresolved',
      extractionMethod: 'llm',
      aiExecutionId: generateId(),
      type: 'body_grounded',
    };
    this.evidence.set(row.id, row);
    return row;
  }

  async findSource() {
    return null;
  }
  async findChunkInProject() {
    return null;
  }
  async findChunkForBlock() {
    return null;
  }
  async findClaim(claimId: string, projectId: string) {
    const row = this.claims.get(claimId);
    if (row === undefined || row.projectId !== projectId) {
      return null;
    }
    return row;
  }
  async createClaim(input: {
    id: string;
    projectId: string;
    text: string;
    coverageAnnotation: Readonly<Record<string, unknown>>;
  }) {
    const methodRaw = input.coverageAnnotation.method;
    const method =
      methodRaw === 'llm' || methodRaw === 'deterministic' || methodRaw === 'human'
        ? methodRaw
        : 'deterministic';
    const aiExecutionId =
      typeof input.coverageAnnotation.aiExecutionId === 'string'
        ? input.coverageAnnotation.aiExecutionId
        : null;
    const row: ClaimRecord = {
      id: input.id,
      projectId: input.projectId,
      text: input.text,
      method,
      aiExecutionId,
      coverageAnnotation: input.coverageAnnotation,
    };
    this.claims.set(row.id, row);
    return row;
  }
  async createArgument(input: {
    id: string;
    projectId: string;
    title: string;
    structure: unknown;
  }) {
    const structure = input.structure as Record<string, unknown>;
    const provenance =
      typeof structure.provenance === 'object' && structure.provenance !== null
        ? (structure.provenance as Record<string, unknown>)
        : {};
    const methodRaw = provenance.method;
    const row: ArgumentRecord = {
      id: input.id,
      projectId: input.projectId,
      title: input.title,
      structure: input.structure,
      method:
        methodRaw === 'llm' || methodRaw === 'deterministic' || methodRaw === 'human'
          ? methodRaw
          : 'deterministic',
      aiExecutionId:
        typeof provenance.aiExecutionId === 'string' ? provenance.aiExecutionId : null,
    };
    this.arguments.set(row.id, row);
    return row;
  }
  async findArgument(argumentId: string, projectId: string) {
    const row = this.arguments.get(argumentId);
    if (row === undefined || row.projectId !== projectId) {
      return null;
    }
    return row;
  }
  async countArgumentLinksForClaim(claimId: string) {
    return this.argumentLinks.filter((link) => link.claimId === claimId).length;
  }
  async countEvidenceLinksForClaim(claimId: string) {
    return this.evidenceLinks.filter((link) => link.claimId === claimId).length;
  }
  async softDeleteClaim(claimId: string, projectId: string) {
    const row = this.claims.get(claimId);
    if (row === undefined || row.projectId !== projectId) {
      return false;
    }
    this.claims.delete(claimId);
    return true;
  }
  async linkArgumentClaim(input: ArgumentClaimLinkRecord) {
    this.argumentLinks.push(input);
    return input;
  }
  async linkEvidenceClaim(input: {
    id: string;
    evidenceId: string;
    claimId: string;
    stance: EvidenceClaimLinkRecord['stance'];
    weight: string;
  }) {
    const row = {
      id: input.id,
      evidenceId: input.evidenceId,
      claimId: input.claimId,
      stance: input.stance,
    };
    this.evidenceLinks.push(row);
    return row;
  }
  async listArgumentClaims(argumentId: string) {
    return this.argumentLinks.filter((link) => link.argumentId === argumentId);
  }
  async listArgumentsForClaim(claimId: string) {
    return this.argumentLinks.filter((link) => link.claimId === claimId);
  }
  async findEvidence(evidenceId: string, projectId: string) {
    const row = this.evidence.get(evidenceId);
    if (row === undefined || row.projectId !== projectId) {
      return null;
    }
    return row;
  }
  async listEvidenceForExecution() {
    return [];
  }
  async findExtractionSet(): Promise<ExtractionSetRecord | null> {
    return null;
  }
  async persistExtractionSet(): Promise<ExtractionSetRecord> {
    throw new Error('unused');
  }
  async findStanceLabel(): Promise<StanceLabelRecord | null> {
    return null;
  }
  async persistStanceLabel(): Promise<StanceLabelRecord> {
    throw new Error('unused');
  }
  async listClaimLinks(claimId: string) {
    return this.evidenceLinks.filter((link) => link.claimId === claimId);
  }
}
