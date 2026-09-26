import { ChatGatewayAdapter } from '../../src/ai/chat/chat-gateway.adapter';
import { AdapterRegistry } from '../../src/ai/adapters/adapter-registry';
import { NoopDataBoundary } from '../../src/ai/boundary/noop-data-boundary';
import { GatewayService } from '../../src/ai/gateway/gateway.service';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import type { AiExecutionLedgerPort, AiExecutionLedgerRecord } from '../../src/l0/ports/ai-execution-ledger.port';
import { computeInputFingerprint } from '../../src/ai/gateway/input-fingerprint';
import { NoopChatStreamSink } from '../../src/orchestration/chat-stream.port';
import { ChatMetrics } from '../../src/orchestration/chat.metrics';
import { PaperChatService } from '../../src/orchestration/paper-chat.service';
import {
  ConversationsRepository,
  MessagesRepository,
} from '../../src/orchestration/scoped-repos';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import type { PlatformLogger } from '../../src/platform/logging';
import { ScopedMetrics } from '../../src/platform/persistence/scoped.metrics';
import { ScopedReader } from '../../src/platform/persistence/scoped-reader';
import { RuntimeRole } from '../../src/platform/runtime/role';
import type {
  IRetrievalService,
  SearchCandidate,
} from '../../src/retrieval/retrieval.port';
import { stubAdaptersWithOcrObject } from '../fixtures/stub-ai-adapters';
import { MemoryMessageEvidenceBindings } from '../fixtures/memory-message-evidence-bindings';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';

class InMemoryLedger implements AiExecutionLedgerPort {
  readonly records: AiExecutionLedgerRecord[] = [];
  async record(input: AiExecutionLedgerRecord): Promise<void> {
    this.records.push(structuredClone(input));
  }
}

class RecordingSink extends NoopChatStreamSink {
  readonly tokens: string[] = [];
  readonly completes: unknown[] = [];
  disconnect = false;

  override emitToken(event: { token: string }): void {
    if (this.disconnect) {
      throw new Error('socket closed');
    }
    this.tokens.push(event.token);
  }

  override emitComplete(event: unknown): void {
    if (this.disconnect) {
      throw new Error('socket closed');
    }
    this.completes.push(event);
  }
}

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

function groundedHit(evidenceId: string): SearchCandidate {
  return {
    chunkId: generateId(),
    projectId: generateId(),
    documentId: generateId(),
    text: 'The trial enrolled 240 patients with glioma.',
    rrfScore: 0.8,
    rerankScore: 0.9,
    vectorScore: 0.2,
    ftsScore: null,
    sourceId: generateId(),
    evidenceRefs: [evidenceId],
    qualityAnnotation: 'body_grounded',
  };
}

describe('DHB-62 Paper Chat', () => {
  const orgId = generateId();
  const projectId = generateId();
  const otherProjectId = generateId();
  const userId = generateId();
  const scope = { projectId };
  const evidenceId = generateId();

  let store: MemoryScopedStore;
  let bindings: MemoryMessageEvidenceBindings;
  let ledger: InMemoryLedger;
  let sink: RecordingSink;
  let retrieve: IRetrievalService['retrieve'] & jest.Mock;
  let service: PaperChatService;
  let conversations: ConversationsRepository;
  let messages: MessagesRepository;

  beforeEach(async () => {
    store = new MemoryScopedStore();
    bindings = new MemoryMessageEvidenceBindings();
    bindings.seedEvidence(projectId, evidenceId);
    ledger = new InMemoryLedger();
    sink = new RecordingSink();
    retrieve = jest.fn(async () => ({
      understoodQuery: 'glioma',
      vectorHits: [],
      ftsHits: [],
      hits: [groundedHit(evidenceId)],
      timings: {
        queryUnderstandingMs: 1,
        vectorMs: 1,
        ftsMs: 1,
        rrfMs: 1,
        rerankMs: 1,
      },
      efSearch: 40,
      limit: 12,
      rerankMethod: 'deterministic' as const,
      rerankExecutionId: null,
      filteredRecallShortfall: 0,
      fallbacksUsed: [],
      latencyMs: 5,
      trace: { id: generateId(), fingerprint: 'retrieval-fp-abc' },
    }));

    const reader = new ScopedReader(store, new ScopedMetrics(stubLogger()));
    conversations = new ConversationsRepository(reader, store);
    messages = new MessagesRepository(reader, store);
    const gateway = new GatewayService(
      new NoopDataBoundary(),
      ledger,
      new PolicyResolver(),
      new PromptAssembler(),
      AdapterRegistry.forAdapters(stubAdaptersWithOcrObject().adapters),
      stubLogger(),
    );
    const chatGateway = new ChatGatewayAdapter(gateway);

    service = new PaperChatService(
      conversations,
      messages,
      { retrieve },
      chatGateway,
      bindings,
      sink,
      new ChatMetrics(stubLogger()),
    );
  });

  async function openConversation(project = projectId): Promise<string> {
    const row = await conversations.create({ projectId: project }, {
      createdBy: userId,
      title: 'Paper chat',
    });
    return row.id;
  }

  it('GAP-INTERACTIVE-STREAM-01: a chat turn creates zero BullMQ jobs', async () => {
    const conversationId = await openConversation();
    await service.sendMessage({
      orgId,
      projectId,
      conversationId,
      content: 'What was the trial size?',
      correlationId: 'cor-chat',
      runtimeRole: RuntimeRole.Api,
    });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]?.capability).toBe('CHAT');
  });

  it('disconnect mid-stream still persists message, execution, and bindings', async () => {
    sink.disconnect = true;
    const conversationId = await openConversation();
    const result = await service.sendMessage({
      orgId,
      projectId,
      conversationId,
      content: 'Summarize enrollment',
      correlationId: 'cor-disconnect',
      runtimeRole: RuntimeRole.Api,
    });
    expect(sink.tokens).toEqual([]);
    expect(sink.completes).toEqual([]);
    const assistant = await messages.get(scope, result.assistantMessage.id);
    expect(assistant.status).toBe('complete');
    expect(assistant.aiExecutionId).toBe(result.aiExecutionId);
    expect(assistant.content).toBe('stub-chat-response');
    expect(ledger.records[0]?.id).toBe(result.aiExecutionId);
    const bound = await bindings.listForMessage(scope, result.assistantMessage.id);
    expect(bound.map((row) => row.evidenceId)).toEqual([evidenceId]);
  });

  it('rejects (conversation_id, sequence) collision', async () => {
    const conversationId = await openConversation();
    await messages.create(scope, {
      conversationId,
      role: 'user',
      content: 'first',
      status: 'complete',
      sequence: 1,
    });
    await expect(
      messages.create(scope, {
        conversationId,
        role: 'user',
        content: 'collision',
        status: 'complete',
        sequence: 1,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.AlreadyExists });
  });

  it('links RetrievalTrace to CHAT execution and folds fingerprint into input_fingerprint', async () => {
    const conversationId = await openConversation();
    const result = await service.sendMessage({
      orgId,
      projectId,
      conversationId,
      content: 'How many patients?',
      correlationId: 'cor-prov',
      runtimeRole: RuntimeRole.Api,
    });
    expect(ledger.records[0]?.retrievalTraceId).toBe(result.retrievalTraceId);
    expect(ledger.records[0]?.inputFingerprint).toBe(result.inputFingerprint);
    expect(result.retrievalFingerprint).toBe('retrieval-fp-abc');

    const withRetrieval = computeInputFingerprint({
      capability: 'CHAT',
      userMessage: 'How many patients?',
      documentContent: 'ctx',
      retrievalFingerprint: 'retrieval-fp-abc',
      retrievalTraceId: result.retrievalTraceId,
    });
    const withoutRetrieval = computeInputFingerprint({
      capability: 'CHAT',
      userMessage: 'How many patients?',
      documentContent: 'ctx',
      retrievalTraceId: result.retrievalTraceId,
    });
    expect(withRetrieval).not.toBe(withoutRetrieval);
  });

  it('does not bind raw candidates without Evidence', async () => {
    retrieve.mockResolvedValueOnce({
      understoodQuery: 'q',
      vectorHits: [],
      ftsHits: [],
      hits: [
        {
          ...groundedHit(evidenceId),
          evidenceRefs: [],
          text: 'raw only',
        },
      ],
      timings: {
        queryUnderstandingMs: 1,
        vectorMs: 1,
        ftsMs: 1,
        rrfMs: 1,
        rerankMs: 1,
      },
      efSearch: 40,
      limit: 12,
      rerankMethod: 'deterministic',
      rerankExecutionId: null,
      filteredRecallShortfall: 0,
      fallbacksUsed: [],
      latencyMs: 5,
      trace: { id: generateId(), fingerprint: 'fp-raw' },
    });
    const conversationId = await openConversation();
    const result = await service.sendMessage({
      orgId,
      projectId,
      conversationId,
      content: 'Anything?',
      correlationId: 'cor-raw',
      runtimeRole: RuntimeRole.Api,
    });
    expect(result.evidenceIds).toEqual([]);
    expect(await bindings.listForMessage(scope, result.assistantMessage.id)).toEqual([]);
  });

  it('returns not_found for cross-project conversationId', async () => {
    const conversationId = await openConversation(otherProjectId);
    await expect(
      service.sendMessage({
        orgId,
        projectId,
        conversationId,
        content: 'leak?',
        correlationId: 'cor-idor',
        runtimeRole: RuntimeRole.Api,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });
});
