import type { IGatewayService } from '../../src/ai/gateway/gateway.port';
import { GatewayExecutionFailedError } from '../../src/ai/gateway/gateway-execution.errors';
import { SynthesisService } from '../../src/apps/worker/synthesis.service';
import { ClaimsMetrics } from '../../src/evidence/claims.metrics';
import { SYNTHESIS_PROMPT_VERSION } from '../../src/evidence/synthesis.constants';
import type {
  ClaimRecord,
  EvidenceClaimLinkRecord,
  EvidenceRecord,
  EvidenceSpinePort,
  ExtractionMatrixStore,
  ExtractionSetRecord,
  StanceLabelRecord,
} from '../../src/l0/ports';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

describe('DHB-69 synthesis evidence grounding', () => {
  const orgId = generateId();
  const projectId = generateId();
  const runId = generateId();

  function logger() {
    return {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger;
  }

  function evidence(
    stance: EvidenceRecord['stance'],
    text: string,
  ): EvidenceRecord {
    return {
      id: generateId(),
      projectId,
      sourceId: generateId(),
      chunkId: generateId(),
      locator: { documentVersionId: generateId(), blockId: generateId(), page: 1 },
      text,
      stance,
      extractionMethod: 'llm',
      aiExecutionId: generateId(),
      type: 'body_grounded',
    };
  }

  it('persists a claim with aiExecutionId and full evidence lineage', async () => {
    const support = evidence('supports', 'trial showed benefit');
    const unresolved = evidence('unresolved', 'signal unclear');
    const spine = new SynthesisSpine([support, unresolved]);
    const aiExecutionId = generateId();
    const gateway: IGatewayService = {
      execute: async () => ({
        capability: 'SYNTHESIS',
        text: 'Benefit is suggested while unresolved evidence remains visible.',
        metrics: { latencyMs: 12, tokensIn: 10, tokensOut: 8, costMicros: 42 },
        inputFingerprint: 'fp',
        promptVersion: SYNTHESIS_PROMPT_VERSION,
        provider: 'stub',
        model: 'stub',
        aiExecutionId,
        method: 'llm',
      }),
    };

    const service = new SynthesisService(
      spine,
      emptyExtractionStore(),
      gateway,
      new ClaimsMetrics(),
      logger(),
    );
    const claimId = generateId();
    const result = await service.execute({
      orgId,
      projectId,
      runId,
      claimId,
      promptVersion: SYNTHESIS_PROMPT_VERSION,
      correlationId: 'cor-synth',
    });

    expect(result.kind).toBe('completed');
    expect(result.aiExecutionId).toBe(aiExecutionId);
    expect([...result.evidenceIds].sort()).toEqual([support.id, unresolved.id].sort());
    expect(spine.claims.get(claimId)?.aiExecutionId).toBe(aiExecutionId);
    expect(spine.evidenceLinks).toHaveLength(2);
    expect(spine.evidenceLinks.map((link) => link.stance).sort()).toEqual([
      'supports',
      'unresolved',
    ]);
  });

  it('produces no claim when the synthesis gateway fails', async () => {
    const row = evidence('supports', 'benefit');
    const spine = new SynthesisSpine([row]);
    const gateway: IGatewayService = {
      execute: async () => {
        throw new GatewayExecutionFailedError(generateId(), ['boom']);
      },
    };
    const metrics = new ClaimsMetrics();
    const service = new SynthesisService(
      spine,
      emptyExtractionStore(),
      gateway,
      metrics,
      logger(),
    );

    await expect(
      service.execute({
        orgId,
        projectId,
        runId,
        claimId: generateId(),
        promptVersion: SYNTHESIS_PROMPT_VERSION,
        correlationId: 'cor-fail',
      }),
    ).rejects.toMatchObject({ name: 'EvidenceJobError', recoverable: true });

    expect(spine.claims.size).toBe(0);
    expect(spine.evidenceLinks).toHaveLength(0);
    expect(metrics.snapshot().synthesisFailureCount).toBe(1);
    expect(metrics.snapshot().claimsSynthesized).toBe(0);
  });

  it('preserves unresolved and keeps conflicting evidence visible in the prompt', async () => {
    const support = evidence('supports', 'supports-marker');
    const oppose = evidence('contradicts', 'oppose-marker');
    const unresolved = evidence('unresolved', 'unresolved-marker');
    const spine = new SynthesisSpine([support, oppose, unresolved]);
    let summaries: readonly string[] = [];
    const gateway: IGatewayService = {
      execute: async (_ctx, request) => {
        if (request.capability !== 'SYNTHESIS') {
          throw new Error('expected SYNTHESIS');
        }
        summaries = request.evidenceSummaries;
        return {
          capability: 'SYNTHESIS' as const,
          text: 'Conflicts remain; unresolved is uncoerced.',
          metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 0 },
          inputFingerprint: 'fp',
          promptVersion: SYNTHESIS_PROMPT_VERSION,
          provider: 'stub',
          model: 'stub',
          aiExecutionId: generateId(),
          method: 'llm' as const,
        };
      },
    };

    const service = new SynthesisService(
      spine,
      emptyExtractionStore(),
      gateway,
      new ClaimsMetrics(),
      logger(),
    );
    const result = await service.execute({
      orgId,
      projectId,
      runId,
      claimId: generateId(),
      promptVersion: SYNTHESIS_PROMPT_VERSION,
      correlationId: 'cor-conflict',
    });

    expect(summaries.some((line) => line.includes('Conflicting evidence'))).toBe(true);
    expect(summaries.some((line) => line.includes('unresolved stance is preserved'))).toBe(
      true,
    );
    expect(summaries.some((line) => line.includes('stance=unresolved'))).toBe(true);
    expect(summaries.some((line) => line.includes('stance=supports'))).toBe(true);
    expect(summaries.some((line) => line.includes('stance=contradicts'))).toBe(true);
    expect(summaries.some((line) => /unresolved.*neutral|coerced.*neutral/i.test(line))).toBe(
      false,
    );
    expect(result.unresolvedShare).toBeCloseTo(1 / 3);
    expect(
      spine.evidenceLinks.map((link) => link.stance).includes('unresolved'),
    ).toBe(true);
  });

  it('rejects synthesis with no evidence lineage before calling the gateway', async () => {
    const spine = new SynthesisSpine([]);
    const execute = jest.fn();
    const service = new SynthesisService(
      spine,
      emptyExtractionStore(),
      { execute } as unknown as IGatewayService,
      new ClaimsMetrics(),
      logger(),
    );

    await expect(
      service.execute({
        orgId,
        projectId,
        runId,
        claimId: generateId(),
        promptVersion: SYNTHESIS_PROMPT_VERSION,
        correlationId: 'cor-empty',
      }),
    ).rejects.toMatchObject({
      name: 'EvidenceJobError',
      recoverable: false,
      message: expect.stringContaining('evidence lineage'),
    });
    expect(execute).not.toHaveBeenCalled();
    expect(spine.claims.size).toBe(0);
  });
});

class SynthesisSpine implements EvidenceSpinePort {
  readonly claims = new Map<string, ClaimRecord>();
  readonly evidenceLinks: EvidenceClaimLinkRecord[] = [];

  constructor(private readonly evidenceRows: EvidenceRecord[]) {}

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
  async createClaim(): Promise<never> {
    throw new Error('unused');
  }
  async createArgument(): Promise<never> {
    throw new Error('unused');
  }
  async findArgument() {
    return null;
  }
  async countArgumentLinksForClaim() {
    return 0;
  }
  async countEvidenceLinksForClaim(claimId: string) {
    return this.evidenceLinks.filter((link) => link.claimId === claimId).length;
  }
  async softDeleteClaim() {
    return false;
  }
  async linkArgumentClaim(): Promise<never> {
    throw new Error('unused');
  }
  async linkEvidenceClaim(): Promise<never> {
    throw new Error('unused');
  }
  async listArgumentClaims() {
    return [];
  }
  async listArgumentsForClaim() {
    return [];
  }
  async findEvidence(evidenceId: string, projectId: string) {
    return (
      this.evidenceRows.find((row) => row.id === evidenceId && row.projectId === projectId) ??
      null
    );
  }
  async listEvidenceForProject(projectId: string) {
    return this.evidenceRows.filter((row) => row.projectId === projectId);
  }
  async listClaimsForProject(projectId: string) {
    return [...this.claims.values()].filter((row) => row.projectId === projectId);
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
  async persistSynthesizedClaim(input: {
    id: string;
    projectId: string;
    text: string;
    aiExecutionId: string;
    evidenceLinks: readonly {
      id: string;
      evidenceId: string;
      stance: EvidenceClaimLinkRecord['stance'];
    }[];
  }) {
    if (input.evidenceLinks.length === 0) {
      throw new Error('empty lineage');
    }
    const claim: ClaimRecord = {
      id: input.id,
      projectId: input.projectId,
      text: input.text,
      method: 'llm',
      aiExecutionId: input.aiExecutionId,
      coverageAnnotation: {
        method: 'llm',
        aiExecutionId: input.aiExecutionId,
        synthesized: true,
      },
    };
    this.claims.set(claim.id, claim);
    const links = input.evidenceLinks.map((link) => ({
      id: link.id,
      evidenceId: link.evidenceId,
      claimId: input.id,
      stance: link.stance,
    }));
    this.evidenceLinks.push(...links);
    return { claim, evidenceLinks: links };
  }
  async listClaimLinks(claimId: string) {
    return this.evidenceLinks.filter((link) => link.claimId === claimId);
  }
}

function emptyExtractionStore(): ExtractionMatrixStore {
  return {
    createSchema: async () => {
      throw new Error('unused');
    },
    findSchema: async () => null,
    createRunBundle: async () => {
      throw new Error('unused');
    },
    findRunByResearchRunId: async () => null,
    findRun: async () => null,
    updateRunState: async () => {
      throw new Error('unused');
    },
    listCells: async () => [],
    findCell: async () => null,
    updateCell: async () => {
      throw new Error('unused');
    },
    countNonTerminalCells: async () => 0,
  };
}
