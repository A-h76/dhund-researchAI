import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { AdapterInvokeOutcome } from '../../src/ai/adapters/adapter-outcome';
import type { AdapterInvokeInput, CapabilityAdapter } from '../../src/ai/adapters/adapter.port';
import { AdapterRegistry } from '../../src/ai/adapters/adapter-registry';
import { NoopDataBoundary } from '../../src/ai/boundary/noop-data-boundary';
import { GatewayService } from '../../src/ai/gateway/gateway.service';
import type { GatewayContext } from '../../src/ai/gateway/gateway.types';
import { computeInputFingerprint } from '../../src/ai/gateway/input-fingerprint';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import { PrismaAiExecutionLedgerAdapter } from '../../src/l0/adapters/prisma/prisma-ai-execution-ledger.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

class CostedChatAdapter implements CapabilityAdapter {
  readonly capability = 'CHAT' as const;

  constructor(private readonly costMicros: number) {}

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    return {
      status: 'ok',
      method: 'llm',
      result: {
        capability: 'CHAT',
        text: 'integration-response',
        inputFingerprint: computeInputFingerprint(input.request),
        promptVersion: input.policy.promptVersion,
        provider: input.policy.provider,
        model: input.policy.modelId,
        metrics: {
          latencyMs: 2,
          tokensIn: 3,
          tokensOut: 5,
          costMicros: this.costMicros,
        },
      },
      attempts: [
        {
          provider: input.policy.provider,
          model: input.policy.modelId,
          status: 'ok',
          latencyMs: 2,
          costMicros: this.costMicros,
        },
      ],
      tokensIn: 3,
      tokensOut: 5,
      costMicros: this.costMicros,
    };
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /foreign key|violates foreign key|restrict/i.test(msg);
}

async function expectRejectsForeignKey(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected foreign key violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected foreign key violation') {
      throw error;
    }
    expect(isForeignKeyViolation(error)).toBe(true);
  }
}

(integrationEnabled ? describe : describe.skip)('DHB-45 AI execution ledger integration', () => {
  jest.setTimeout(360_000);

  let prisma!: PrismaClient;
  let gateway!: GatewayService;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const databaseUrl = postgres.getConnectionUri();

    execSync('npx prisma migrate deploy', {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();

    const connectionConfig: L0ConnectionConfig = {
      databaseUrl,
      redisUrl: 'redis://127.0.0.1:6379',
      databasePoolSize: 5,
    };

    const databaseAdapter = new PrismaDatabaseAdapter(connectionConfig);
    await databaseAdapter.connect();
    const ledger = new PrismaAiExecutionLedgerAdapter(databaseAdapter);

    gateway = new GatewayService(
      new NoopDataBoundary(),
      ledger,
      new PolicyResolver(),
      new PromptAssembler(),
      AdapterRegistry.forAdapters([new CostedChatAdapter(2500)]),
      {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      } as unknown as PlatformLogger,
    );

    stop = async () => {
      await databaseAdapter.disconnect();
      await prisma.$disconnect();
      await postgres.stop();
    };
  });

  afterAll(async () => {
    if (stop) {
      await stop();
    }
  });

  async function insertUser(email: string): Promise<string> {
    const id = generateId();
    await prisma.user.create({ data: { id, email, displayName: 'Ledger Test User' } });
    return id;
  }

  async function createPersonalOrgProject(): Promise<{
    userId: string;
    orgId: string;
    projectId: string;
  }> {
    const userId = await insertUser(`dhb45-${generateId()}@example.com`);
    const orgId = generateId();
    const projectId = generateId();
    await prisma.organization.create({
      data: { id: orgId, kind: 'PERSONAL', name: 'Personal', ownerUserId: userId },
    });
    await prisma.project.create({ data: { id: projectId, orgId, name: 'Project' } });
    return { userId, orgId, projectId };
  }

  async function createResearchRun(
    orgId: string,
    projectId: string,
    userId: string,
  ): Promise<string> {
    const runId = generateId();
    await prisma.researchRun.create({
      data: {
        id: runId,
        orgId,
        projectId,
        initiatedBy: userId,
        preset: 'deep_research',
        reservedMicros: 1_000_000n,
        idempotencyKey: `key-${generateId()}`,
      },
    });
    return runId;
  }

  async function createDocumentGraph(
    projectId: string,
    orgId: string,
  ): Promise<{ documentId: string; chunkId: string }> {
    const documentId = generateId();
    const versionId = generateId();
    const chunkId = generateId();
    const storageKey = `doc/${generateId()}`;
    await prisma.document.create({
      data: { id: documentId, projectId, orgId, title: 'Paper', storageKey },
    });
    await prisma.documentVersion.create({
      data: { id: versionId, documentId, versionNo: 1, storageKey: `${storageKey}/v1` },
    });
    await prisma.chunk.create({
      data: {
        id: chunkId,
        documentVersionId: versionId,
        projectId,
        ordinal: 0,
        charSpan: { start: 0, end: 10 },
        tokenCount: 3,
        blockIds: [],
        contentHash: `hash-${generateId()}`,
        chunkerVersion: 'v1',
        text: '',
      },
    });
    return { documentId, chunkId };
  }

  function apiContext(
    orgId: string,
    projectId?: string,
    researchRunId?: string,
  ): GatewayContext {
    return {
      orgId,
      ...(projectId !== undefined ? { projectId } : {}),
      ...(researchRunId !== undefined ? { researchRunId } : {}),
      correlationId: `corr-${generateId()}`,
      runtimeRole: RuntimeRole.Api,
    };
  }

  it('increments research_runs.consumed_micros synchronously for researchRunId', async () => {
    const { userId, orgId, projectId } = await createPersonalOrgProject();
    const runId = await createResearchRun(orgId, projectId, userId);

    const result = await gateway.execute(apiContext(orgId, projectId, runId), {
      capability: 'CHAT',
      userMessage: 'hello',
    });

    const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.consumedMicros).toBe(2500n);

    const execution = await prisma.aiExecution.findUniqueOrThrow({
      where: { id: result.aiExecutionId },
      include: { attempts: true },
    });
    expect(execution.researchRunId).toBe(runId);
    expect(execution.costMicros).toBe(2500n);
    expect(execution.attempts).toHaveLength(1);
  });

  it('handles concurrent consumed_micros increments safely', async () => {
    const { userId, orgId, projectId } = await createPersonalOrgProject();
    const runId = await createResearchRun(orgId, projectId, userId);

    await Promise.all(
      Array.from({ length: 4 }, () =>
        gateway.execute(apiContext(orgId, projectId, runId), {
          capability: 'CHAT',
          userMessage: 'hello',
        }),
      ),
    );

    const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.consumedMicros).toBe(10_000n);
  });

  it('reconciles SUM(ai_executions.cost_micros) with consumed_micros', async () => {
    const { userId, orgId, projectId } = await createPersonalOrgProject();
    const runId = await createResearchRun(orgId, projectId, userId);

    await gateway.execute(apiContext(orgId, projectId, runId), {
      capability: 'CHAT',
      userMessage: 'one',
    });
    await gateway.execute(apiContext(orgId, projectId, runId), {
      capability: 'CHAT',
      userMessage: 'two',
    });

    const aggregate = await prisma.aiExecution.aggregate({
      where: { researchRunId: runId },
      _sum: { costMicros: true },
    });
    const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });

    expect(aggregate._sum.costMicros).toBe(5000n);
    expect(run.consumedMicros).toBe(aggregate._sum.costMicros);
  });

  it('resolves aiExecutionId to an Evidence row via existing schema fixture', async () => {
    const { orgId, projectId } = await createPersonalOrgProject();
    const { documentId, chunkId } = await createDocumentGraph(projectId, orgId);
    const executionId = generateId();

    await prisma.aiExecution.create({
      data: {
        id: executionId,
        orgId,
        projectId,
        capability: 'STANCE',
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptVersion: 'v1',
        inputFingerprint: 'fp',
        status: 'ok',
        method: 'llm',
        correlationId: generateId(),
      },
    });

    const sourceId = generateId();
    await prisma.source.create({
      data: { id: sourceId, projectId, type: 'document', documentId },
    });

    const evidenceId = generateId();
    await prisma.evidence.create({
      data: {
        id: evidenceId,
        projectId,
        sourceId,
        chunkId,
        locator: { page: 1 },
        text: 'fixture fact',
        qualityScore: 1,
        extractionMethod: 'llm',
        aiExecutionId: executionId,
        type: 'body_grounded',
      },
    });

    const evidence = await prisma.evidence.findUniqueOrThrow({
      where: { id: evidenceId },
      include: { aiExecution: true },
    });

    expect(evidence.aiExecution?.id).toBe(executionId);
  });

  it('rejects deleting ai_executions referenced by Evidence (RESTRICT)', async () => {
    const { orgId, projectId } = await createPersonalOrgProject();
    const { documentId, chunkId } = await createDocumentGraph(projectId, orgId);
    const executionId = generateId();

    await prisma.aiExecution.create({
      data: {
        id: executionId,
        orgId,
        projectId,
        capability: 'STANCE',
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptVersion: 'v1',
        inputFingerprint: 'fp',
        status: 'ok',
        method: 'llm',
        correlationId: generateId(),
      },
    });

    const sourceId = generateId();
    await prisma.source.create({
      data: { id: sourceId, projectId, type: 'document', documentId },
    });

    await prisma.evidence.create({
      data: {
        id: generateId(),
        projectId,
        sourceId,
        chunkId,
        locator: { page: 1 },
        text: 'fixture fact',
        qualityScore: 1,
        extractionMethod: 'llm',
        aiExecutionId: executionId,
        type: 'body_grounded',
      },
    });

    await expectRejectsForeignKey(() =>
      prisma.aiExecution.delete({ where: { id: executionId } }),
    );
  });
});
