import { AI_CAPABILITIES } from '../../src/ai/capability';
import { AdapterRegistry } from '../../src/ai/adapters/adapter-registry';
import { StubChatAdapter } from '../../src/ai/adapters/stub/stub-adapters';
import { BoundaryMetrics } from '../../src/ai/boundary/boundary-metrics';
import { findBoundaryRefusal } from '../../src/ai/boundary/find-boundary-refusal';
import {
  DATA_BOUNDARY_REFUSED_ACTION,
  GatewayDataBoundary,
} from '../../src/ai/boundary/gateway-data-boundary';
import { GatewayService } from '../../src/ai/gateway/gateway.service';
import type { GatewayContext, GatewayRequest } from '../../src/ai/gateway/gateway.types';
import type { AuditEventAppendInput, AuditEventPort } from '../../src/l0/ports/audit-event.port';
import type {
  AiExecutionLedgerPort,
  AiExecutionLedgerRecord,
} from '../../src/l0/ports/ai-execution-ledger.port';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import { DomainError } from '../../src/platform/errors/domain-error';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';
import { stubAdaptersWithOcrObject } from '../fixtures/stub-ai-adapters';

const DOCUMENT_BODY = 'UNIQUE_DOCUMENT_BODY_MUST_NOT_LEAK';
const PROMPT_BODY = 'UNIQUE_PROMPT_TEXT_MUST_NOT_LEAK';
const EVIDENCE_BODY = 'UNIQUE_EVIDENCE_TEXT_MUST_NOT_LEAK';

class TrackingAudit implements AuditEventPort {
  readonly entries: AuditEventAppendInput[] = [];
  failNext = false;

  async append(input: AuditEventAppendInput): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('audit unavailable');
    }
    this.entries.push(structuredClone(input));
  }
}

class TrackingLedger implements AiExecutionLedgerPort {
  readonly records: AiExecutionLedgerRecord[] = [];

  async record(input: AiExecutionLedgerRecord): Promise<void> {
    this.records.push(structuredClone(input));
  }
}

function apiContext(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    orgId: '00000000-0000-7000-8000-000000000001',
    correlationId: 'corr-api',
    runtimeRole: RuntimeRole.Api,
    ...overrides,
  };
}

function workerContext(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    orgId: '00000000-0000-7000-8000-000000000001',
    correlationId: 'corr-worker',
    runtimeRole: RuntimeRole.Worker,
    ...overrides,
  };
}

function requestForCapability(capability: GatewayRequest['capability']): GatewayRequest {
  switch (capability) {
    case 'CHAT':
      return { capability, userMessage: PROMPT_BODY, documentContent: DOCUMENT_BODY };
    case 'EMBED':
      return { capability, texts: [DOCUMENT_BODY], inputType: 'query' };
    case 'RERANK':
      return { capability, query: PROMPT_BODY, candidates: [DOCUMENT_BODY] };
    case 'AUTOCOMPLETE':
      return { capability, prefix: 'hel', documentContent: DOCUMENT_BODY };
    case 'EXTRACT_CELL':
      return { capability, columnKey: 'year', documentContent: DOCUMENT_BODY };
    case 'SCREENING':
      return { capability, criteria: 'include rct', documentContent: DOCUMENT_BODY };
    case 'STANCE':
      return { capability, claim: 'X helps Y', documentContent: DOCUMENT_BODY };
    case 'SYNTHESIS':
      return { capability, evidenceSummaries: [EVIDENCE_BODY], documentContent: DOCUMENT_BODY };
    case 'OCR':
      return { capability, objectKey: 'uploads/doc.pdf' };
    default: {
      const _exhaustive: never = capability;
      throw new Error(String(_exhaustive));
    }
  }
}

function contextFor(capability: GatewayRequest['capability'], overrides: Partial<GatewayContext> = {}): GatewayContext {
  const isBatch =
    capability === 'EMBED' ||
    capability === 'EXTRACT_CELL' ||
    capability === 'SCREENING' ||
    capability === 'STANCE' ||
    capability === 'SYNTHESIS' ||
    capability === 'OCR';
  return isBatch ? workerContext(overrides) : apiContext(overrides);
}

function createLogger(): PlatformLogger {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as unknown as PlatformLogger;
}

function createGateway(options: { audit?: TrackingAudit; metrics?: BoundaryMetrics } = {}) {
  const audit = options.audit ?? new TrackingAudit();
  const metrics = options.metrics ?? new BoundaryMetrics();
  const logger = createLogger();
  const ledger = new TrackingLedger();
  const adapters = stubAdaptersWithOcrObject().adapters.map((adapter) => {
    const invoke = jest.spyOn(adapter, 'invoke');
    return { adapter, invoke };
  });
  const registry = AdapterRegistry.forAdapters(adapters.map((entry) => entry.adapter));
  const getSpy = jest.spyOn(registry, 'get');
  const assembler = new PromptAssembler();
  const boundary = new GatewayDataBoundary(audit, metrics, logger);
  const gateway = new GatewayService(
    boundary,
    ledger,
    new PolicyResolver(),
    assembler,
    registry,
    logger,
  );

  return { gateway, audit, metrics, logger, ledger, getSpy, adapters };
}

describe('declared-clinical refusal and object-storage gates (DHB-47)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refuses declared-clinical requests for every capability before adapter dispatch', async () => {
    for (const capability of AI_CAPABILITIES) {
      const { gateway, audit, metrics, ledger, getSpy, adapters, logger } = createGateway();
      const request = requestForCapability(capability);

      await expect(
        gateway.execute(contextFor(capability, { declaredClinical: true, researchRunId: 'run-1' }), request),
      ).rejects.toMatchObject({
        name: 'DomainError',
        code: ErrorCode.AiDataBoundaryViolation,
      });

      expect(getSpy).not.toHaveBeenCalled();
      for (const entry of adapters) {
        expect(entry.invoke).not.toHaveBeenCalled();
      }
      expect(ledger.records).toEqual([]);
      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0]?.action).toBe(DATA_BOUNDARY_REFUSED_ACTION);
      expect(audit.entries[0]?.scope).toMatchObject({
        capability,
        reason: 'declared_clinical',
        researchRunId: 'run-1',
      });
      expect(JSON.stringify(audit.entries[0])).not.toContain(DOCUMENT_BODY);
      expect(JSON.stringify(audit.entries[0])).not.toContain(PROMPT_BODY);
      expect(JSON.stringify(audit.entries[0])).not.toContain(EVIDENCE_BODY);
      expect(metrics.snapshot().rejectionsByReason.declared_clinical).toBe(1);

      const logPayload = JSON.stringify((logger.info as jest.Mock).mock.calls);
      expect(logPayload).toContain('ai.data_boundary.refused');
      expect(logPayload).not.toContain(DOCUMENT_BODY);
      expect(logPayload).not.toContain(PROMPT_BODY);
      expect(logPayload).not.toContain(EVIDENCE_BODY);

      jest.restoreAllMocks();
    }
  });

  it('still refuses when audit persistence fails', async () => {
    const audit = new TrackingAudit();
    audit.failNext = true;
    const chat = new StubChatAdapter();
    const invoke = jest.spyOn(chat, 'invoke');
    const logger = createLogger();
    const ledger = new TrackingLedger();
    const gateway = new GatewayService(
      new GatewayDataBoundary(audit, new BoundaryMetrics(), logger),
      ledger,
      new PolicyResolver(),
      new PromptAssembler(),
      AdapterRegistry.forAdapters([chat]),
      logger,
    );

    await expect(
      gateway.execute(apiContext({ declaredClinical: true }), {
        capability: 'CHAT',
        userMessage: PROMPT_BODY,
      }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(invoke).not.toHaveBeenCalled();
    expect(ledger.records).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('allows OCR objectKey and refuses object-storage handles on other capabilities', () => {
    expect(
      findBoundaryRefusal(workerContext(), { capability: 'OCR', objectKey: 'uploads/doc.pdf' }),
    ).toBeUndefined();

    expect(
      findBoundaryRefusal(apiContext(), {
        capability: 'CHAT',
        userMessage: 'hello',
        objectKey: 'uploads/doc.pdf',
      } as GatewayRequest),
    ).toBe('object_storage_bytes_not_ocr');

    expect(
      findBoundaryRefusal(apiContext(), {
        capability: 'CHAT',
        userMessage: 'hello',
        presignedUrl: 'https://bucket.example/doc.pdf?X-Amz-Signature=abc',
      } as GatewayRequest),
    ).toBe('presigned_url_not_ocr');

    expect(
      findBoundaryRefusal(workerContext(), {
        capability: 'OCR',
        objectKey: 'https://bucket.example/doc.pdf',
      }),
    ).toBe('presigned_url_not_ocr');

    expect(
      findBoundaryRefusal(apiContext(), {
        capability: 'CHAT',
        userMessage: 'hello',
        bytes: Buffer.from('scan'),
      } as unknown as GatewayRequest),
    ).toBe('object_storage_bytes_not_ocr');
  });

  it('does not treat biomedical literature text as a declared-clinical request', () => {
    expect(
      findBoundaryRefusal(workerContext(), {
        capability: 'SCREENING',
        criteria: 'randomized trial',
        documentContent: 'A biomedical paper on kinase inhibition in mice.',
      }),
    ).toBeUndefined();
  });

  it('refuses smuggled presigned URLs before the adapter is reached', async () => {
    const { gateway, getSpy, adapters, ledger, audit } = createGateway();

    await expect(
      gateway.execute(
        apiContext(),
        {
          capability: 'CHAT',
          userMessage: 'hello',
          presignedUrl: 'https://example.com/secret',
        } as GatewayRequest,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.AiDataBoundaryViolation });

    expect(getSpy).not.toHaveBeenCalled();
    expect(adapters[0]?.invoke).not.toHaveBeenCalled();
    expect(ledger.records).toEqual([]);
    expect(audit.entries[0]?.scope).toMatchObject({ reason: 'presigned_url_not_ocr' });
  });

  it('allows undeclared literature requests through to the adapter', async () => {
    const { gateway, getSpy, ledger, audit } = createGateway();

    const result = await gateway.execute(apiContext(), {
      capability: 'CHAT',
      userMessage: 'summarize this paper',
    });

    expect(result.capability).toBe('CHAT');
    expect(getSpy).toHaveBeenCalledWith('CHAT');
    expect(ledger.records).toHaveLength(1);
    expect(audit.entries).toEqual([]);
  });
});
