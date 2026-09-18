import { Inject, Injectable } from '@nestjs/common';
import {
  CITATION_PROJECTION,
  type CitationProjectionPort,
  type SentenceBindingRecord,
} from '../l0/ports/citation-projection.port';
import {
  EXTRACT_STORE,
  type ExtractStore,
} from '../l0/ports';
import {
  EVIDENCE_SPINE,
  type EvidenceLocatorValue,
  type EvidenceRecord,
  type EvidenceSpinePort,
} from '../l0/ports/evidence-spine.port';
import { notFound } from '../platform/errors/domain-error';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import { CitationMetrics } from './citations.metrics';

export type ProjectionHop =
  | 'binding'
  | 'evidence'
  | 'locator'
  | 'chunk'
  | 'documentVersion'
  | 'source'
  | 'aiExecutionId';

export type EvidenceQualityLabel = 'body_grounded' | 'metadata_only';

export interface CompleteEvidenceChain {
  readonly status: 'complete';
  readonly bindingId: string;
  readonly evidenceId: string;
  readonly quality: EvidenceQualityLabel;
  readonly locator: EvidenceLocatorValue;
  readonly chunk: { readonly id: string; readonly documentVersionId: string } | null;
  readonly documentVersion: {
    readonly id: string;
    readonly documentId: string;
    readonly versionNo: number;
  };
  readonly source: {
    readonly id: string;
    readonly documentId: string | null;
    readonly type: 'document' | 'external_record';
  };
  readonly aiExecutionId: string | null;
}

export interface BrokenEvidenceChain {
  readonly status: 'broken';
  readonly bindingId: string;
  readonly evidenceId: string;
  readonly missingHops: readonly ProjectionHop[];
}

export type EvidenceChain = CompleteEvidenceChain | BrokenEvidenceChain;

export interface SentenceProjection {
  readonly writingId: string;
  readonly projectId: string;
  readonly writingVersionId: string;
  readonly sentenceHash: string;
  readonly status: 'complete' | 'broken';
  readonly chains: readonly EvidenceChain[];
}

@Injectable()
export class SentenceProjectionService {
  constructor(
    @Inject(CITATION_PROJECTION) private readonly store: CitationProjectionPort,
    @Inject(EVIDENCE_SPINE) private readonly spine: EvidenceSpinePort,
    @Inject(EXTRACT_STORE) private readonly extract: ExtractStore,
    private readonly metrics: CitationMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async projectSentence(input: {
    writingId: string;
    sentenceHash: string;
    projectId: string;
  }): Promise<SentenceProjection> {
    const started = Date.now();
    const writing = await this.store.findWriting(input.writingId);
    if (
      writing === null ||
      writing.deletedAt !== null ||
      writing.projectId !== input.projectId ||
      writing.currentVersionId === null
    ) {
      throw notFound({ module: 'evidence' });
    }

    const bindings = await this.store.listBindingsForSentence({
      writingId: writing.id,
      writingVersionId: writing.currentVersionId,
      sentenceHash: input.sentenceHash,
      projectId: writing.projectId,
    });
    if (bindings.length === 0) {
      throw notFound({ module: 'evidence' });
    }

    const chains: EvidenceChain[] = [];
    for (const binding of bindings) {
      chains.push(await this.walkChain(binding, writing.projectId));
    }

    const broken = chains.some((chain) => chain.status === 'broken');
    const result: SentenceProjection = {
      writingId: writing.id,
      projectId: writing.projectId,
      writingVersionId: writing.currentVersionId,
      sentenceHash: input.sentenceHash,
      status: broken ? 'broken' : 'complete',
      chains,
    };

    this.metrics.recordProjection({
      latencyMs: Date.now() - started,
      broken,
    });
    if (broken) {
      this.logger.warn({
        module: 'evidence',
        message: 'sentence.projection.broken',
        writingId: writing.id,
        sentenceHash: input.sentenceHash,
        brokenChainCount: chains.filter((chain) => chain.status === 'broken').length,
      });
    }
    return result;
  }

  async evidenceProducedBy(aiExecutionId: string): Promise<readonly EvidenceRecord[]> {
    return this.spine.listEvidenceForExecution(aiExecutionId);
  }

  private async walkChain(
    binding: SentenceBindingRecord,
    projectId: string,
  ): Promise<EvidenceChain> {
    const missingHops: ProjectionHop[] = [];

    const evidence = await this.spine.findEvidence(binding.evidenceId, projectId);
    if (evidence === null) {
      return {
        status: 'broken',
        bindingId: binding.id,
        evidenceId: binding.evidenceId,
        missingHops: ['evidence', 'locator', 'chunk', 'documentVersion', 'source', 'aiExecutionId'],
      };
    }

    const locatorOk = isLocatorResolvable(evidence.locator);
    if (!locatorOk) {
      missingHops.push('locator');
    }

    let chunk: CompleteEvidenceChain['chunk'] = null;
    const needsChunk = evidence.type === 'body_grounded';
    if (needsChunk) {
      if (evidence.chunkId === null) {
        missingHops.push('chunk');
      } else {
        const found = await this.spine.findChunkInProject(evidence.chunkId, projectId);
        if (
          found === null ||
          found.documentVersionId !== evidence.locator.documentVersionId ||
          !found.blockIds.includes(evidence.locator.blockId)
        ) {
          missingHops.push('chunk');
        } else {
          chunk = { id: found.id, documentVersionId: found.documentVersionId };
        }
      }
    } else if (evidence.chunkId !== null) {
      const found = await this.spine.findChunkInProject(evidence.chunkId, projectId);
      if (found === null) {
        missingHops.push('chunk');
      } else {
        chunk = { id: found.id, documentVersionId: found.documentVersionId };
      }
    }

    const version = locatorOk
      ? await this.getVersionWithDocument(evidence.locator.documentVersionId)
      : null;
    if (version === null || version.projectId !== projectId) {
      missingHops.push('documentVersion');
    }

    const source = await this.spine.findSource(evidence.sourceId);
    if (source === null || source.projectId !== projectId) {
      missingHops.push('source');
    } else if (
      version !== null &&
      source.type === 'document' &&
      source.documentId !== version.documentId
    ) {
      missingHops.push('source');
    }

    const needsExecution = evidence.extractionMethod === 'llm';
    if (needsExecution && (evidence.aiExecutionId === null || evidence.aiExecutionId.length === 0)) {
      missingHops.push('aiExecutionId');
    }

    if (missingHops.length > 0) {
      return {
        status: 'broken',
        bindingId: binding.id,
        evidenceId: evidence.id,
        missingHops,
      };
    }

    if (version === null || source === null) {
      return {
        status: 'broken',
        bindingId: binding.id,
        evidenceId: evidence.id,
        missingHops: ['documentVersion', 'source'],
      };
    }

    return {
      status: 'complete',
      bindingId: binding.id,
      evidenceId: evidence.id,
      quality: evidence.type,
      locator: evidence.locator,
      chunk,
      documentVersion: {
        id: version.id,
        documentId: version.documentId,
        versionNo: version.versionNo ?? 1,
      },
      source: {
        id: source.id,
        documentId: source.documentId,
        type: source.type,
      },
      aiExecutionId: evidence.aiExecutionId,
    };
  }

  private getVersionWithDocument(documentVersionId: string) {
    return this.extract.findVersion(documentVersionId);
  }
}

function isLocatorResolvable(locator: EvidenceLocatorValue): boolean {
  return (
    locator.documentVersionId.length > 0 &&
    locator.blockId.length > 0 &&
    Number.isFinite(locator.page) &&
    locator.page >= 1
  );
}
