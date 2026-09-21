import type { IGatewayService } from '../../src/ai/gateway/gateway.port';
import { GatewayExecutionFailedError } from '../../src/ai/gateway/gateway-execution.errors';
import { StanceService } from '../../src/apps/worker/stance.service';
import { EvidenceMetrics } from '../../src/evidence/evidence.metrics';
import type {
  ClaimRecord,
  EvidenceRecord,
  EvidenceSpinePort,
  ExtractionSetRecord,
  StanceLabelRecord,
} from '../../src/l0/ports/evidence-spine.port';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

describe('DHB-59 stance service (§11.4)', () => {
  const orgId = generateId();
  const projectId = generateId();
  const runId = generateId();
  const claimId = generateId();
  const evidenceSupportId = generateId();
  const evidenceOpposeId = generateId();

  function logger() {
    return {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger;
  }

  function spineWith(evidenceRows: EvidenceRecord[]) {
    const spine = new StanceSpine();
    for (const row of evidenceRows) {
      spine.evidence.set(row.id, row);
    }
    spine.claims.set(claimId, {
      id: claimId,
      projectId,
      text: 'Treatment reduces events',
      method: 'deterministic',
      aiExecutionId: null,
      coverageAnnotation: { method: 'deterministic' },
    });
    return spine;
  }

  function row(id: string): EvidenceRecord {
    return {
      id,
      projectId,
      sourceId: generateId(),
      chunkId: generateId(),
      locator: { documentVersionId: generateId(), blockId: generateId(), page: 1 },
      text: 'reduction in events',
      stance: 'unresolved',
      extractionMethod: 'llm',
      aiExecutionId: generateId(),
      type: 'body_grounded',
    };
  }

  it('stores unresolved as unresolved, never neutral', async () => {
    const spine = spineWith([row(evidenceSupportId)]);
    const gateway: IGatewayService = {
      execute: async () => ({
        capability: 'STANCE',
        stance: 'unresolved',
        metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 0 },
        inputFingerprint: 'fp',
        promptVersion: 'stance_v1',
        provider: 'stub',
        model: 'stub',
        aiExecutionId: generateId(),
        method: 'llm',
      }),
    };
    const service = new StanceService(spine, gateway, new EvidenceMetrics(), logger());
    const result = await service.execute({
      orgId,
      projectId,
      runId,
      evidenceId: evidenceSupportId,
      claimId,
      correlationId: 'cor-stance',
    });
    expect(result.stance).toBe('unresolved');
    expect(spine.evidence.get(evidenceSupportId)?.stance).toBe('unresolved');
    expect(spine.claimLinks[0]?.stance).toBe('unresolved');
  });

  it('lets opposing stances on one claim coexist', async () => {
    const spine = spineWith([row(evidenceSupportId), row(evidenceOpposeId)]);
    const service = new StanceService(
      spine,
      {
        execute: async (_ctx, request) => {
          if (request.capability !== 'STANCE') {
            throw new Error('expected STANCE');
          }
          return {
            capability: 'STANCE' as const,
            stance: request.claim.includes('oppose-marker') ? 'oppose' : 'support',
            metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 0 },
            inputFingerprint: 'fp',
            promptVersion: 'stance_v1',
            provider: 'stub',
            model: 'stub',
            aiExecutionId: generateId(),
            method: 'llm' as const,
          };
        },
      },
      new EvidenceMetrics(),
      logger(),
    );

    spine.claims.set(claimId, {
      id: claimId,
      projectId,
      text: 'Treatment reduces events',
      method: 'deterministic',
      aiExecutionId: null,
      coverageAnnotation: { method: 'deterministic' },
    });
    await service.execute({
      orgId,
      projectId,
      runId,
      evidenceId: evidenceSupportId,
      claimId,
      correlationId: 'cor-a',
    });

    spine.claims.set(claimId, {
      id: claimId,
      projectId,
      text: 'oppose-marker',
      method: 'deterministic',
      aiExecutionId: null,
      coverageAnnotation: { method: 'deterministic' },
    });
    await service.execute({
      orgId,
      projectId,
      runId,
      evidenceId: evidenceOpposeId,
      claimId,
      correlationId: 'cor-b',
    });

    const links = await spine.listClaimLinks(claimId);
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.stance).sort()).toEqual(['contradicts', 'supports']);
  });

  it('retries after success do not relabel or duplicate provenance', async () => {
    const spine = spineWith([row(evidenceSupportId)]);
    let calls = 0;
    const gateway: IGatewayService = {
      execute: async () => {
        calls += 1;
        return {
          capability: 'STANCE',
          stance: 'support',
          metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 0 },
          inputFingerprint: 'fp',
          promptVersion: 'stance_v1',
          provider: 'stub',
          model: 'stub',
          aiExecutionId: generateId(),
          method: 'llm',
        };
      },
    };
    const service = new StanceService(spine, gateway, new EvidenceMetrics(), logger());
    const job = {
      orgId,
      projectId,
      runId,
      evidenceId: evidenceSupportId,
      claimId,
      correlationId: 'cor-stance',
    };
    const first = await service.execute(job);
    const second = await service.execute(job);
    expect(first.kind).toBe('completed');
    expect(second.kind).toBe('idempotent');
    expect(calls).toBe(1);
    expect(spine.stanceLabels).toHaveLength(1);
  });

  it('does not write a stance on AI failure', async () => {
    const spine = spineWith([row(evidenceSupportId)]);
    const gateway: IGatewayService = {
      execute: async () => {
        throw new GatewayExecutionFailedError('exec-fail', ['down']);
      },
    };
    const service = new StanceService(spine, gateway, new EvidenceMetrics(), logger());
    await expect(
      service.execute({
        orgId,
        projectId,
        runId,
        evidenceId: evidenceSupportId,
        claimId,
        correlationId: 'cor-fail',
      }),
    ).rejects.toBeDefined();
    expect(spine.evidence.get(evidenceSupportId)?.stance).toBe('unresolved');
    expect(spine.stanceLabels).toHaveLength(0);
  });
});

class StanceSpine implements EvidenceSpinePort {
  readonly evidence = new Map<string, EvidenceRecord>();
  readonly claims = new Map<string, ClaimRecord>();
  readonly stanceLabels: StanceLabelRecord[] = [];
  readonly claimLinks: Array<{ id: string; evidenceId: string; claimId: string; stance: StanceLabelRecord['stance'] }> =
    [];

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
    const claim = this.claims.get(claimId);
    if (claim === undefined || claim.projectId !== projectId) {
      return null;
    }
    return claim;
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
  async listEvidenceForProject(projectId: string) {
    return [...this.evidence.values()].filter((row) => row.projectId === projectId);
  }
  async listClaimsForProject(projectId: string) {
    return [...this.claims.values()].filter((row) => row.projectId === projectId);
  }
  async persistSynthesizedClaim(): Promise<never> {
    throw new Error('unused');
  }
  async findExtractionSet(): Promise<ExtractionSetRecord | null> {
    return null;
  }
  async persistExtractionSet(): Promise<ExtractionSetRecord> {
    throw new Error('unused');
  }
  async findStanceLabel(runId: string, evidenceId: string) {
    return this.stanceLabels.find((row) => row.runId === runId && row.evidenceId === evidenceId) ?? null;
  }
  async persistStanceLabel(input: {
    outboxId: string;
    runId: string;
    evidenceId: string;
    projectId: string;
    stance: StanceLabelRecord['stance'];
    aiExecutionId: string;
    claimId: string | null;
    claimLinkId: string | null;
    correlationId: string;
  }) {
    const existing = await this.findStanceLabel(input.runId, input.evidenceId);
    if (existing !== null) {
      return existing;
    }
    const evidence = this.evidence.get(input.evidenceId);
    if (evidence !== undefined) {
      this.evidence.set(input.evidenceId, { ...evidence, stance: input.stance });
    }
    if (input.claimId !== null && input.claimLinkId !== null) {
      this.claimLinks.push({
        id: input.claimLinkId,
        evidenceId: input.evidenceId,
        claimId: input.claimId,
        stance: input.stance,
      });
    }
    const record: StanceLabelRecord = {
      runId: input.runId,
      evidenceId: input.evidenceId,
      stance: input.stance,
      aiExecutionId: input.aiExecutionId,
      claimId: input.claimId,
    };
    this.stanceLabels.push(record);
    return record;
  }
  async listClaimLinks(claimId: string) {
    return this.claimLinks.filter((row) => row.claimId === claimId);
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
  async countEvidenceLinksForClaim() {
    return 0;
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
}
