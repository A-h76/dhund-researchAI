import { CitationsService } from '../../src/evidence/citations.service';
import { CitationMetrics } from '../../src/evidence/citations.metrics';
import { SentenceProjectionService } from '../../src/evidence/sentence-projection.service';
import type {
  CitationProjectionPort,
  CitationRecord,
  CreateCitationInput,
  SentenceBindingRecord,
  WritingRecord,
} from '../../src/l0/ports/citation-projection.port';
import type { ExtractStore, ExtractVersionRecord } from '../../src/l0/ports';
import type {
  ChunkRecord,
  EvidenceRecord,
  EvidenceSpinePort,
  SourceRecord,
} from '../../src/l0/ports/evidence-spine.port';
import { L0OperationError } from '../../src/l0/ports/errors';
import { DomainError } from '../../src/platform/errors/domain-error';
import { ErrorCode, httpStatusFor } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

describe('DHB-61 citations and §19.3 projection', () => {
  const projectId = generateId();
  const otherProjectId = generateId();

  function logger(): PlatformLogger {
    return {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger;
  }

  it('rejects a citation with zero or two targets', async () => {
    const world = new ProjectionWorld();
    const citations = new CitationsService(world, world as unknown as EvidenceSpinePort);
    await expect(
      citations.create({
        projectId,
        cslJson: {},
        qualityAnnotation: 'metadata_only',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationError });

    const evidence = world.addEvidence(projectId);
    const source = world.addSource(projectId, evidence.sourceId);
    await expect(
      citations.create({
        projectId,
        resolvesToEvidenceId: evidence.id,
        resolvesToSourceId: source.id,
        cslJson: {},
        qualityAnnotation: 'body_grounded',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
  });

  it('creates a citation that resolves to exactly one target and keeps quality_annotation', async () => {
    const world = new ProjectionWorld();
    const citations = new CitationsService(world, world as unknown as EvidenceSpinePort);
    const evidence = world.addEvidence(projectId);
    const created = await citations.create({
      projectId,
      resolvesToEvidenceId: evidence.id,
      cslJson: { title: 'Paper' },
      qualityAnnotation: 'body_grounded',
    });
    expect(created.resolvesToEvidenceId).toBe(evidence.id);
    expect(created.resolvesToSourceId).toBeNull();
    expect(created.qualityAnnotation).toBe('body_grounded');
  });

  it('returns the complete §19.3 chain for a bound sentence', async () => {
    const world = new ProjectionWorld();
    const seeded = world.seedBoundSentence(projectId);
    const service = new SentenceProjectionService(
      world,
      world as unknown as EvidenceSpinePort,
      world as unknown as ExtractStore,
      new CitationMetrics(),
      logger(),
    );
    const result = await service.projectSentence({
      writingId: seeded.writingId,
      sentenceHash: seeded.sentenceHash,
      projectId,
    });
    expect(result.status).toBe('complete');
    expect(result.chains).toHaveLength(1);
    const chain = result.chains[0];
    expect(chain.status).toBe('complete');
    if (chain.status !== 'complete') {
      throw new Error('expected complete chain');
    }
    expect(chain.bindingId).toBe(seeded.bindingId);
    expect(chain.evidenceId).toBe(seeded.evidenceId);
    expect(chain.quality).toBe('body_grounded');
    expect(chain.locator).toEqual(seeded.locator);
    expect(chain.chunk).toEqual({
      id: seeded.chunkId,
      documentVersionId: seeded.documentVersionId,
    });
    expect(chain.documentVersion.id).toBe(seeded.documentVersionId);
    expect(chain.source.id).toBe(seeded.sourceId);
    expect(chain.aiExecutionId).toBe(seeded.aiExecutionId);
    expect(JSON.stringify(chain)).toContain('body_grounded');
    expect(JSON.stringify(chain)).not.toMatch(/"quality":true/);
  });

  it('reports a missing hop as broken instead of a partial complete chain', async () => {
    const world = new ProjectionWorld();
    const seeded = world.seedBoundSentence(projectId);
    world.removeDocumentVersion(seeded.documentVersionId);
    const service = new SentenceProjectionService(
      world,
      world as unknown as EvidenceSpinePort,
      world as unknown as ExtractStore,
      new CitationMetrics(),
      logger(),
    );
    const result = await service.projectSentence({
      writingId: seeded.writingId,
      sentenceHash: seeded.sentenceHash,
      projectId,
    });
    expect(result.status).toBe('broken');
    expect(result.chains[0]).toEqual({
      status: 'broken',
      bindingId: seeded.bindingId,
      evidenceId: seeded.evidenceId,
      missingHops: ['documentVersion'],
    });
    expect(result.chains[0]).not.toHaveProperty('locator');
    expect(result.chains[0]).not.toHaveProperty('source');
  });

  it('reaches every evidence row produced by an aiExecutionId', async () => {
    const world = new ProjectionWorld();
    const aiExecutionId = generateId();
    const first = world.addEvidence(projectId, { aiExecutionId });
    const second = world.addEvidence(projectId, { aiExecutionId });
    world.addEvidence(projectId, { aiExecutionId: generateId() });
    const service = new SentenceProjectionService(
      world,
      world as unknown as EvidenceSpinePort,
      world as unknown as ExtractStore,
      new CitationMetrics(),
      logger(),
    );
    const produced = await service.evidenceProducedBy(aiExecutionId);
    expect(produced.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
    expect(produced).toHaveLength(2);
  });

  it('keeps resolving a cited evidence row after supersession', async () => {
    const world = new ProjectionWorld();
    const seeded = world.seedBoundSentence(projectId);
    world.supersede(seeded.evidenceId, projectId);
    const service = new SentenceProjectionService(
      world,
      world as unknown as EvidenceSpinePort,
      world as unknown as ExtractStore,
      new CitationMetrics(),
      logger(),
    );
    const result = await service.projectSentence({
      writingId: seeded.writingId,
      sentenceHash: seeded.sentenceHash,
      projectId,
    });
    expect(result.status).toBe('complete');
    expect(result.chains[0].status).toBe('complete');
    expect(result.chains[0].evidenceId).toBe(seeded.evidenceId);
  });

  it('returns 404 for a cross-project writingId', async () => {
    const world = new ProjectionWorld();
    const seeded = world.seedBoundSentence(projectId);
    const service = new SentenceProjectionService(
      world,
      world as unknown as EvidenceSpinePort,
      world as unknown as ExtractStore,
      new CitationMetrics(),
      logger(),
    );
    try {
      await service.projectSentence({
        writingId: seeded.writingId,
        sentenceHash: seeded.sentenceHash,
        projectId: otherProjectId,
      });
      throw new Error('expected not found');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(ErrorCode.NotFound);
      expect(httpStatusFor((error as DomainError).code)).toBe(404);
    }
  });

  it('keeps metadata_only as a distinct label without requiring a chunk', async () => {
    const world = new ProjectionWorld();
    const seeded = world.seedBoundSentence(projectId, { type: 'metadata_only', chunk: false });
    const service = new SentenceProjectionService(
      world,
      world as unknown as EvidenceSpinePort,
      world as unknown as ExtractStore,
      new CitationMetrics(),
      logger(),
    );
    const result = await service.projectSentence({
      writingId: seeded.writingId,
      sentenceHash: seeded.sentenceHash,
      projectId,
    });
    expect(result.status).toBe('complete');
    const chain = result.chains[0];
    expect(chain.status).toBe('complete');
    if (chain.status !== 'complete') {
      throw new Error('expected complete');
    }
    expect(chain.quality).toBe('metadata_only');
    expect(chain.chunk).toBeNull();
    expect(JSON.stringify(chain)).toContain('metadata_only');
  });
});

class ProjectionWorld implements CitationProjectionPort {
  readonly writings = new Map<string, WritingRecord>();
  readonly bindings: SentenceBindingRecord[] = [];
  readonly citations: CitationRecord[] = [];
  readonly evidence = new Map<string, EvidenceRecord>();
  readonly sources = new Map<string, SourceRecord>();
  readonly chunks = new Map<string, ChunkRecord>();
  readonly versions = new Map<string, ExtractVersionRecord>();

  async createCitation(input: CreateCitationInput): Promise<CitationRecord> {
    const evidenceId = input.resolvesToEvidenceId ?? null;
    const sourceId = input.resolvesToSourceId ?? null;
    if ((evidenceId === null ? 0 : 1) + (sourceId === null ? 0 : 1) !== 1) {
      throw new L0OperationError('Citation must resolve to exactly one target');
    }
    const record: CitationRecord = {
      id: input.id,
      projectId: input.projectId,
      writingId: input.writingId ?? null,
      resolvesToEvidenceId: evidenceId,
      resolvesToSourceId: sourceId,
      cslJson: input.cslJson,
      qualityAnnotation: input.qualityAnnotation,
    };
    this.citations.push(record);
    return record;
  }

  async listCitations(projectId: string): Promise<readonly CitationRecord[]> {
    return this.citations.filter((row) => row.projectId === projectId);
  }

  async findWriting(writingId: string): Promise<WritingRecord | null> {
    return this.writings.get(writingId) ?? null;
  }

  async listBindingsForSentence(input: {
    writingId: string;
    writingVersionId: string;
    sentenceHash: string;
    projectId: string;
  }): Promise<readonly SentenceBindingRecord[]> {
    return this.bindings.filter(
      (row) =>
        row.writingId === input.writingId &&
        row.writingVersionId === input.writingVersionId &&
        row.sentenceHash === input.sentenceHash &&
        row.projectId === input.projectId,
    );
  }

  async findSource(sourceId: string): Promise<SourceRecord | null> {
    return this.sources.get(sourceId) ?? null;
  }

  async findChunkInProject(chunkId: string, projectId: string): Promise<ChunkRecord | null> {
    const chunk = this.chunks.get(chunkId);
    if (chunk === undefined || chunk.projectId !== projectId) {
      return null;
    }
    return chunk;
  }

  async findEvidence(evidenceId: string, projectId: string): Promise<EvidenceRecord | null> {
    const row = this.evidence.get(evidenceId);
    if (row === undefined || row.projectId !== projectId) {
      return null;
    }
    return row;
  }

  async listEvidenceForExecution(aiExecutionId: string): Promise<readonly EvidenceRecord[]> {
    return [...this.evidence.values()].filter((row) => row.aiExecutionId === aiExecutionId);
  }

  async getVersionWithDocument(documentVersionId: string): Promise<ExtractVersionRecord | null> {
    return this.versions.get(documentVersionId) ?? null;
  }

  async findVersion(documentVersionId: string): Promise<ExtractVersionRecord | null> {
    return this.versions.get(documentVersionId) ?? null;
  }

  addSource(projectId: string, sourceId = generateId(), documentId = generateId()): SourceRecord {
    const source: SourceRecord = {
      id: sourceId,
      projectId,
      documentId,
      type: 'document',
    };
    this.sources.set(source.id, source);
    return source;
  }

  addEvidence(
    projectId: string,
    overrides: Partial<EvidenceRecord> & { documentId?: string } = {},
  ): EvidenceRecord {
    const documentVersionId = overrides.locator?.documentVersionId ?? generateId();
    const blockId = overrides.locator?.blockId ?? generateId();
    const documentId = overrides.documentId ?? generateId();
    const source =
      this.sources.get(overrides.sourceId ?? '') ??
      this.addSource(projectId, overrides.sourceId, documentId);
    const chunkId = overrides.chunkId === undefined ? generateId() : overrides.chunkId;
    if (chunkId !== null && !this.chunks.has(chunkId)) {
      this.chunks.set(chunkId, {
        id: chunkId,
        projectId,
        documentVersionId,
        text: 'quoted',
        blockIds: [blockId],
      });
    }
    if (!this.versions.has(documentVersionId)) {
      this.versions.set(documentVersionId, {
        id: documentVersionId,
        documentId: source.documentId ?? documentId,
        orgId: generateId(),
        projectId,
        storageKey: 's3://doc/v1',
        documentStatus: 'completed',
        deletedAt: null,
        versionNo: 1,
      });
    }
    const evidenceOverrides: Partial<EvidenceRecord> = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'documentId' || value === undefined) {
        continue;
      }
      (evidenceOverrides as Record<string, unknown>)[key] = value;
    }
    const evidence: EvidenceRecord = {
      id: generateId(),
      projectId,
      sourceId: source.id,
      chunkId,
      locator: {
        documentVersionId,
        blockId,
        page: 1,
      },
      text: 'quoted',
      stance: 'unresolved',
      extractionMethod: 'llm',
      aiExecutionId: generateId(),
      type: 'body_grounded',
      ...evidenceOverrides,
    };
    this.evidence.set(evidence.id, evidence);
    return evidence;
  }

  seedBoundSentence(
    projectId: string,
    options: { type?: 'body_grounded' | 'metadata_only'; chunk?: boolean } = {},
  ): {
    writingId: string;
    sentenceHash: string;
    bindingId: string;
    evidenceId: string;
    sourceId: string;
    chunkId: string | null;
    documentVersionId: string;
    locator: EvidenceRecord['locator'];
    aiExecutionId: string | null;
  } {
    const writingId = generateId();
    const writingVersionId = generateId();
    const sentenceHash = `sha256:${generateId()}`;
    const type = options.type ?? 'body_grounded';
    const withChunk = options.chunk ?? type === 'body_grounded';
    const evidence = this.addEvidence(projectId, {
      type,
      extractionMethod: 'llm',
      ...(withChunk ? {} : { chunkId: null }),
    });
    this.writings.set(writingId, {
      id: writingId,
      projectId,
      currentVersionId: writingVersionId,
      deletedAt: null,
    });
    const bindingId = generateId();
    this.bindings.push({
      id: bindingId,
      writingId,
      writingVersionId,
      projectId,
      sentenceHash,
      evidenceId: evidence.id,
      strength: '1',
    });
    return {
      writingId,
      sentenceHash,
      bindingId,
      evidenceId: evidence.id,
      sourceId: evidence.sourceId,
      chunkId: evidence.chunkId,
      documentVersionId: evidence.locator.documentVersionId,
      locator: evidence.locator,
      aiExecutionId: evidence.aiExecutionId,
    };
  }

  removeDocumentVersion(documentVersionId: string): void {
    this.versions.delete(documentVersionId);
  }

  supersede(evidenceId: string, projectId: string): EvidenceRecord {
    const replacement = this.addEvidence(projectId);
    const existing = this.evidence.get(evidenceId);
    if (existing === undefined) {
      throw new Error('missing evidence');
    }
    this.evidence.set(evidenceId, existing);
    return replacement;
  }
}
