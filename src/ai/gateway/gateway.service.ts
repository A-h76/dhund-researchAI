import { Inject, Injectable } from '@nestjs/common';
import type { AiExecutionLedgerPort } from '../../l0/ports/ai-execution-ledger.port';
import { AI_EXECUTION_LEDGER } from '../../l0/ports/tokens';
import { generateId } from '../../platform/ids/uuid-v7';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { assertIntegerMicros } from '../../platform/money/micros';
import { AdapterRegistry } from '../adapters/adapter-registry';
import type { IDataBoundaryCheck } from '../boundary/data-boundary.port';
import { DATA_BOUNDARY_CHECK } from '../tokens';
import { assertRoleAllowed } from '../policy/capability-routing';
import { PolicyResolver } from '../policy/policy-resolver';
import { PromptAssembler } from '../policy/prompt-assembler';
import { validateGatewayRequest } from '../validation/request-validation';
import type { GatewayExecuteOptions, IGatewayService } from './gateway.port';
import type { GatewayContext, GatewayRequest, GatewayResult } from './gateway.types';
import { GatewayExecutionFailedError } from './gateway-execution.errors';
import { computeInputFingerprint } from './input-fingerprint';

@Injectable()
export class GatewayService implements IGatewayService {
  constructor(
    @Inject(DATA_BOUNDARY_CHECK)
    private readonly boundary: IDataBoundaryCheck,
    @Inject(AI_EXECUTION_LEDGER)
    private readonly ledger: AiExecutionLedgerPort,
    private readonly policyResolver: PolicyResolver,
    private readonly promptAssembler: PromptAssembler,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly logger: PlatformLogger,
  ) {}

  async execute(
    ctx: GatewayContext,
    request: GatewayRequest,
    options: GatewayExecuteOptions = {},
  ): Promise<GatewayResult> {
    const started = Date.now();

    await this.boundary.assertAllowed(ctx, request);
    assertRoleAllowed(ctx.runtimeRole, request.capability, request);

    const policy = this.policyResolver.resolve(request);
    validateGatewayRequest(request);

    const payload = this.promptAssembler.assemble(request, policy);
    this.promptAssembler.assertNoSecretsInPayload(payload, ctx.secretsContext ?? {});

    const inputFingerprint = computeInputFingerprint(request);
    const adapter = this.adapterRegistry.get(request.capability);
    const outcome = await adapter.invoke({
      ctx,
      policy,
      payload,
      request,
      ...(options.onToken !== undefined ? { onToken: options.onToken } : {}),
    });

    assertIntegerMicros(outcome.costMicros);
    for (const attempt of outcome.attempts) {
      assertIntegerMicros(attempt.costMicros);
    }

    const aiExecutionId = generateId();
    const attemptRecords = outcome.attempts.map((attempt, index) => ({
      id: generateId(),
      attemptNo: index + 1,
      provider: attempt.provider,
      model: attempt.model,
      status: attempt.status,
      ...(attempt.error !== undefined ? { error: attempt.error } : {}),
      latencyMs: attempt.latencyMs,
      costMicros: attempt.costMicros,
    }));

    const latencyMs = Date.now() - started;
    const retrievalTraceId =
      request.capability === 'CHAT' ? request.retrievalTraceId : undefined;

    await this.ledger.record({
      id: aiExecutionId,
      orgId: ctx.orgId,
      ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
      ...(ctx.researchRunId !== undefined ? { researchRunId: ctx.researchRunId } : {}),
      ...(retrievalTraceId !== undefined ? { retrievalTraceId } : {}),
      capability: request.capability,
      provider: policy.provider,
      model: policy.modelId,
      promptVersion: policy.promptVersion,
      inputFingerprint,
      status: outcome.status,
      method: outcome.method,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      costMicros: outcome.costMicros,
      latencyMs,
      correlationId: ctx.correlationId,
      attempts: attemptRecords,
    });

    const logMeta = {
      module: 'ai.gateway' as const,
      capability: request.capability,
      provider: policy.provider,
      model: policy.modelId,
      promptVersion: policy.promptVersion,
      inputFingerprint,
      costMicros: outcome.costMicros,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      latencyMs,
      aiExecutionId,
      correlationId: ctx.correlationId,
      ...(retrievalTraceId !== undefined ? { retrievalTraceId } : {}),
    };

    if (outcome.status === 'failed') {
      this.logger.info({
        ...logMeta,
        message: 'ai.execution.failed',
      });

      const attemptErrors = outcome.attempts
        .map((attempt) => attempt.error)
        .filter((error): error is string => error !== undefined);

      throw new GatewayExecutionFailedError(aiExecutionId, attemptErrors);
    }

    if (outcome.result === undefined) {
      throw new Error('Successful AI execution missing adapter result');
    }

    this.logger.info({
      ...logMeta,
      message: 'ai.execution.completed',
    });

    return {
      ...outcome.result,
      aiExecutionId,
      method: outcome.method,
      metrics: {
        ...outcome.result.metrics,
        latencyMs,
      },
    };
  }
}
