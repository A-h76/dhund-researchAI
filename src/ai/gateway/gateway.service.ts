import { Inject, Injectable } from '@nestjs/common';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { AdapterRegistry } from '../adapters/adapter-registry';
import type { IDataBoundaryCheck } from '../boundary/data-boundary.port';
import { DATA_BOUNDARY_CHECK } from '../tokens';
import { assertRoleAllowed } from '../policy/capability-routing';
import { PolicyResolver } from '../policy/policy-resolver';
import { PromptAssembler } from '../policy/prompt-assembler';
import { validateGatewayRequest } from '../validation/request-validation';
import type { IGatewayService } from './gateway.port';
import type { GatewayContext, GatewayRequest, GatewayResult } from './gateway.types';
import { computeInputFingerprint } from './input-fingerprint';

@Injectable()
export class GatewayService implements IGatewayService {
  constructor(
    @Inject(DATA_BOUNDARY_CHECK)
    private readonly boundary: IDataBoundaryCheck,
    private readonly policyResolver: PolicyResolver,
    private readonly promptAssembler: PromptAssembler,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly logger: PlatformLogger,
  ) {}

  async execute(ctx: GatewayContext, request: GatewayRequest): Promise<GatewayResult> {
    const started = Date.now();

    await this.boundary.assertAllowed(ctx, request);
    assertRoleAllowed(ctx.runtimeRole, request.capability);

    const policy = this.policyResolver.resolve(request);
    validateGatewayRequest(request);

    const payload = this.promptAssembler.assemble(request, policy);
    this.promptAssembler.assertNoSecretsInPayload(payload, ctx.secretsContext ?? {});

    const adapter = this.adapterRegistry.get(request.capability);
    const result = await adapter.invoke({
      ctx,
      policy,
      payload,
      request,
    });

    const latencyMs = Date.now() - started;
    this.logger.info({
      module: 'ai.gateway',
      message: 'ai.gateway.executed',
      capability: request.capability,
      provider: policy.provider,
      model: policy.modelId,
      promptVersion: policy.promptVersion,
      inputFingerprint: computeInputFingerprint(request),
      latencyMs,
      tokensIn: result.metrics.tokensIn,
      tokensOut: result.metrics.tokensOut,
      costMicros: result.metrics.costMicros,
      correlationId: ctx.correlationId,
    });

    return {
      ...result,
      metrics: {
        ...result.metrics,
        latencyMs,
      },
    };
  }
}
