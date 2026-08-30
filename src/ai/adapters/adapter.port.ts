import type { GatewayContext, GatewayRequest, AssembledProviderPayload, GatewayResult } from '../gateway/gateway.types';
import type { PolicyDecision } from '../policy/policy.types';
import type { AiCapability } from '../capability';

export interface AdapterInvokeInput {
  readonly ctx: GatewayContext;
  readonly policy: PolicyDecision;
  readonly payload: AssembledProviderPayload;
  readonly request: GatewayRequest;
}

export interface CapabilityAdapter {
  readonly capability: AiCapability;
  invoke(input: AdapterInvokeInput): Promise<GatewayResult>;
}

export interface AdapterDispatchRecord {
  readonly capability: AiCapability;
  readonly provider: string;
  readonly model: string;
}
