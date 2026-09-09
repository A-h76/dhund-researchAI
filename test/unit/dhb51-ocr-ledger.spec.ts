import { AdapterRegistry } from '../../src/ai/adapters/adapter-registry';
import { createStubAdapters } from '../../src/ai/adapters/stub/stub-adapters';
import { BoundaryMetrics } from '../../src/ai/boundary/boundary-metrics';
import { GatewayDataBoundary } from '../../src/ai/boundary/gateway-data-boundary';
import { GatewayService } from '../../src/ai/gateway/gateway.service';
import { computeInputFingerprint } from '../../src/ai/gateway/input-fingerprint';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import type { AiExecutionLedgerPort, AiExecutionLedgerRecord } from '../../src/l0/ports/ai-execution-ledger.port';
import type { AuditEventPort } from '../../src/l0/ports/audit-event.port';
import { RuntimeRole } from '../../src/platform/runtime/role';
import type { PlatformLogger } from '../../src/platform/logging';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';

class TrackingLedger implements AiExecutionLedgerPort {
  readonly records: AiExecutionLedgerRecord[] = [];
  async record(input: AiExecutionLedgerRecord): Promise<void> {
    this.records.push(structuredClone(input));
  }
}

describe('DHB-51 OCR provenance', () => {
  it('records exactly one ai_executions row per OCR gateway call', async () => {
    const storage = new MemoryObjectStorage();
    storage.put('uploads/scan.pdf', Buffer.from('%PDF-1.4 scanned'));
    const ledger = new TrackingLedger();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger;
    const gateway = new GatewayService(
      new GatewayDataBoundary(
        { append: async () => undefined } as AuditEventPort,
        new BoundaryMetrics(),
        logger,
      ),
      ledger,
      new PolicyResolver(),
      new PromptAssembler(),
      AdapterRegistry.forAdapters(createStubAdapters(storage)),
      logger,
    );

    const request = {
      capability: 'OCR' as const,
      objectKey: 'uploads/scan.pdf',
    };
    const result = await gateway.execute(
      {
        orgId: '00000000-0000-7000-8000-000000000001',
        projectId: '00000000-0000-7000-8000-000000000002',
        correlationId: 'cor-ocr-ledger',
        runtimeRole: RuntimeRole.Worker,
      },
      request,
    );

    expect(result.capability).toBe('OCR');
    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]?.capability).toBe('OCR');
    expect(ledger.records[0]?.status).toBe('ok');
    expect(ledger.records[0]?.inputFingerprint).toBe(computeInputFingerprint(request));
  });

  it('does not put a fetchable URL into the assembled OCR payload or fingerprint', () => {
    const request = {
      capability: 'OCR' as const,
      objectKey: 'uploads/scan.pdf',
    };
    const payload = new PromptAssembler().assemble(request, {
      capability: 'OCR',
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      promptVersion: 'ocr_v1',
    });
    expect(payload.userPayload).toBe('uploads/scan.pdf');
    expect(payload.userPayload).not.toMatch(/^https?:\/\//i);
    expect(payload.systemPrompt).not.toMatch(/^https?:\/\//i);
    expect(JSON.stringify(request)).not.toMatch(/presigned/i);
    expect(computeInputFingerprint(request)).toBe(computeInputFingerprint({ ...request }));
  });
});
