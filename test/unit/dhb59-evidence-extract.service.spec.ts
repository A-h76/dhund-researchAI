import { AdapterRegistry } from '../../src/ai/adapters/adapter-registry';
import type { AdapterInvokeInput, CapabilityAdapter } from '../../src/ai/adapters/adapter.port';
import type { AdapterInvokeOutcome } from '../../src/ai/adapters/adapter-outcome';
import { NoopDataBoundary } from '../../src/ai/boundary/noop-data-boundary';
import { GatewayService } from '../../src/ai/gateway/gateway.service';
import type { IGatewayService } from '../../src/ai/gateway/gateway.port';
import type { EvidenceExtractCandidate } from '../../src/ai/gateway/gateway.types';
import { GatewayExecutionFailedError } from '../../src/ai/gateway/gateway-execution.errors';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import { EvidenceExtractService } from '../../src/apps/worker/evidence-extract.service';
import { EVIDENCE_EXTRACT_STEP_TYPE } from '../../src/evidence/extract.constants';
import { EvidenceMetrics } from '../../src/evidence/evidence.metrics';
import type { ExtractStore, StoredBlock } from '../../src/l0/ports';
import type {
  EvidenceRecord,
  EvidenceSpinePort,
  ExtractionSetRecord,
  PersistExtractedEvidenceInput,
  StanceLabelRecord,
} from '../../src/l0/ports/evidence-spine.port';
import type { AiExecutionLedgerPort, AiExecutionLedgerRecord } from '../../src/l0/ports/ai-execution-ledger.port';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

const BLOCK_TEXT = 'Randomized trials showed a reduction in events among treated patients.';

describe('DHB-59 evidence-extract service (§11.3)', () => {
  const orgId = generateId();
  const projectId = generateId();
  const runId = generateId();
  const stepId = generateId();
  const sourceId = generateId();
  const documentId = generateId();
  const documentVersionId = generateId();
  const blockId = generateId();
  const chunkId = generateId();

  function payload() {
    return {
      orgId,
      projectId,
      runId,
      stepId,
      stepType: EVIDENCE_EXTRACT_STEP_TYPE,
      inputFingerprint: 'fp-extract-1',
      stepVersion: 'v1',
      sourceId,
      documentVersionId,
      correlationId: 'cor-extract',
    };
  }

  function harness(options?: {
    candidates?: readonly EvidenceExtractCandidate[];
    gateway?: IGatewayService;
    ledger?: TrackingLedger;
  }) {
    const spine = new InMemorySpine();
    spine.sources.set(sourceId, {
      id: sourceId,
      projectId,
      documentId,
      type: 'document',
    });
    spine.chunks.set(chunkId, {
      id: chunkId,
      projectId,
      documentVersionId,
      text: BLOCK_TEXT,
      blockIds: [blockId],
    });

    const blocks: StoredBlock[] = [
      {
        id: blockId,
        documentVersionId,
        page: 1,
        ordinal: 0,
        text: BLOCK_TEXT,
      },
    ];

    const store = {
      findVersion: async () => ({
        id: documentVersionId,
        documentId,
        orgId,
        projectId,
        storageKey: 'org/proj/doc.pdf',
        documentStatus: 'completed',
        deletedAt: null,
        versionNo: 1,
      }),
      listBlocks: async () => blocks,
      findBlock: async (id: string) => blocks.find((block) => block.id === id) ?? null,
      findExtraction: async () => null,
      insertExtractionWithBlocks: async () => 'created' as const,
      markDocumentStatus: async () => undefined,
      bodyCapability: async () => 'unrestricted' as const,
    } satisfies ExtractStore;

    const metrics = new EvidenceMetrics();
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger;

    const gateway =
      options?.gateway ??
      ({
        execute: async () => ({
          capability: 'EVIDENCE_EXTRACT' as const,
          candidates: options?.candidates ?? [
            {
              text: 'reduction in events',
              locator: { documentVersionId, blockId, page: 1 },
              type: 'body_grounded' as const,
              chunkId,
            },
          ],
          metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 9 },
          inputFingerprint: 'gw-fp',
          promptVersion: 'evidence_extract_v1',
          provider: 'stub',
          model: 'stub',
          aiExecutionId: generateId(),
          method: 'llm' as const,
        }),
      } satisfies IGatewayService);

    const service = new EvidenceExtractService(
      spine,
      store,
      gateway,
      metrics,
      logger,
    );

    return { service, spine, gateway, metrics };
  }

  it('retrying evidence-extract twice yields one evidence set and no duplicate provenance', async () => {
    const { service, spine } = harness();
    const first = await service.execute(payload());
    const second = await service.execute(payload());

    expect(first.kind).toBe('completed');
    expect(second.kind).toBe('idempotent');
    expect(spine.evidence.size).toBe(1);
    expect(second.evidenceIds).toEqual(first.evidenceIds);
    const executions = [...spine.evidence.values()].map((row) => row.aiExecutionId);
    expect(new Set(executions).size).toBe(1);
  });

  it('omitting a locator yields no row and does not crash', async () => {
    const { service, spine } = harness({
      candidates: [{ text: 'reduction in events' }],
    });
    const result = await service.execute(payload());
    expect(result.evidenceIds).toHaveLength(0);
    expect(result.omittedLocatorCount).toBe(1);
    expect(spine.evidence.size).toBe(0);
  });

  it('forced AI failure writes zero evidence rows', async () => {
    const gateway: IGatewayService = {
      execute: async () => {
        throw new GatewayExecutionFailedError('exec-fail', ['provider down']);
      },
    };
    const { service, spine } = harness({ gateway });
    await expect(service.execute(payload())).rejects.toMatchObject({
      message: 'Gateway evidence-extract execution failed',
    });
    expect(spine.evidence.size).toBe(0);
  });

  it('writes an execution row before return on success and failure', async () => {
    const ledger = new TrackingLedger();
    const successGateway = createGateway(ledger, [new ExtractAdapter([{
      text: 'reduction in events',
      locator: { documentVersionId, blockId, page: 1 },
      type: 'body_grounded',
      chunkId,
    }])]);
    const { service: successService } = harness({ gateway: successGateway });
    await successService.execute(payload());
    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]?.status).toBe('ok');
    expect(ledger.records[0]?.capability).toBe('EVIDENCE_EXTRACT');
    expect(ledger.records[0]?.attempts).toHaveLength(2);

    const failLedger = new TrackingLedger();
    const failGateway = createGateway(failLedger, [new FailingExtractAdapter()]);
    const { service: failService, spine } = harness({ gateway: failGateway });
    await expect(failService.execute({ ...payload(), stepId: generateId() })).rejects.toBeDefined();
    expect(failLedger.records).toHaveLength(1);
    expect(failLedger.records[0]?.status).toBe('failed');
    expect(spine.evidence.size).toBe(0);
  });
});

class TrackingLedger implements AiExecutionLedgerPort {
  readonly records: AiExecutionLedgerRecord[] = [];
  async record(input: AiExecutionLedgerRecord): Promise<void> {
    this.records.push(structuredClone(input));
  }
}

class ExtractAdapter implements CapabilityAdapter {
  readonly capability = 'EVIDENCE_EXTRACT' as const;
  constructor(private readonly candidates: readonly EvidenceExtractCandidate[]) {}
  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    return {
      status: 'ok',
      method: 'llm',
      result: {
        capability: 'EVIDENCE_EXTRACT',
        candidates: this.candidates,
        inputFingerprint: 'fp',
        promptVersion: input.policy.promptVersion,
        provider: input.policy.provider,
        model: input.policy.modelId,
        metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 0 },
      },
      attempts: [
        {
          provider: input.policy.provider,
          model: input.policy.modelId,
          status: 'failed',
          error: 'transient',
          latencyMs: 1,
          costMicros: 0,
        },
        {
          provider: input.policy.provider,
          model: input.policy.modelId,
          status: 'ok',
          latencyMs: 1,
          costMicros: 0,
        },
      ],
      tokensIn: 1,
      tokensOut: 1,
      costMicros: 0,
    };
  }
}

class FailingExtractAdapter implements CapabilityAdapter {
  readonly capability = 'EVIDENCE_EXTRACT' as const;
  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    void input;
    return {
      status: 'failed',
      method: 'llm',
      attempts: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          status: 'failed',
          error: 'forced failure',
          latencyMs: 1,
          costMicros: 0,
        },
      ],
      tokensIn: 0,
      tokensOut: 0,
      costMicros: 0,
    };
  }
}

function createGateway(ledger: TrackingLedger, adapters: readonly CapabilityAdapter[]): GatewayService {
  return new GatewayService(
    new NoopDataBoundary(),
    ledger,
    new PolicyResolver(),
    new PromptAssembler(),
    AdapterRegistry.forAdapters(adapters),
    {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger,
  );
}

class InMemorySpine implements EvidenceSpinePort {
  readonly sources = new Map<string, { id: string; projectId: string; documentId: string | null; type: 'document' | 'external_record' }>();
  readonly chunks = new Map<string, { id: string; projectId: string; documentVersionId: string; text: string; blockIds: readonly string[] }>();
  readonly evidence = new Map<string, EvidenceRecord>();
  readonly extractionSets = new Map<string, ExtractionSetRecord>();
  readonly stanceLabels: StanceLabelRecord[] = [];
  readonly claimLinks: Array<{ id: string; evidenceId: string; claimId: string; stance: StanceLabelRecord['stance'] }> = [];

  async findSource(sourceId: string) {
    return this.sources.get(sourceId) ?? null;
  }
  async findChunkInProject(chunkId: string, projectId: string) {
    const chunk = this.chunks.get(chunkId);
    if (chunk === undefined || chunk.projectId !== projectId) {
      return null;
    }
    return chunk;
  }
  async findChunkForBlock(input: { projectId: string; documentVersionId: string; blockId: string }) {
    for (const chunk of this.chunks.values()) {
      if (
        chunk.projectId === input.projectId &&
        chunk.documentVersionId === input.documentVersionId &&
        chunk.blockIds.includes(input.blockId)
      ) {
        return chunk;
      }
    }
    return null;
  }
  async findClaim() {
    return null;
  }
  async findEvidence(evidenceId: string, projectId: string) {
    const row = this.evidence.get(evidenceId);
    if (row === undefined || row.projectId !== projectId) {
      return null;
    }
    return row;
  }
  async listEvidenceForExecution(aiExecutionId: string) {
    return [...this.evidence.values()].filter((row) => row.aiExecutionId === aiExecutionId);
  }
  async listEvidenceForProject(projectId: string) {
    return [...this.evidence.values()].filter((row) => row.projectId === projectId);
  }
  async listClaimsForProject() {
    return [];
  }
  async persistSynthesizedClaim(): Promise<never> {
    throw new Error('unused');
  }
  async findExtractionSet(stepId: string) {
    return this.extractionSets.get(stepId) ?? null;
  }
  async persistExtractionSet(input: {
    stepId: string;
    runId: string;
    inputFingerprint: string;
    correlationId: string;
    aiExecutionId: string;
    omittedLocatorCount: number;
    evidence: readonly PersistExtractedEvidenceInput[];
  }) {
    const existing = this.extractionSets.get(input.stepId);
    if (existing !== undefined) {
      return existing;
    }
    for (const row of input.evidence) {
      this.evidence.set(row.id, {
        id: row.id,
        projectId: row.projectId,
        sourceId: row.sourceId,
        chunkId: row.chunkId,
        locator: row.locator,
        text: row.text,
        stance: 'unresolved',
        extractionMethod: 'llm',
        aiExecutionId: row.aiExecutionId,
        type: row.type,
      });
    }
    const record: ExtractionSetRecord = {
      stepId: input.stepId,
      runId: input.runId,
      inputFingerprint: input.inputFingerprint,
      aiExecutionId: input.aiExecutionId,
      evidenceIds: input.evidence.map((row) => row.id),
      omittedLocatorCount: input.omittedLocatorCount,
    };
    this.extractionSets.set(input.stepId, record);
    return record;
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
