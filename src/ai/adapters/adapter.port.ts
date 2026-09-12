import type { GatewayContext, GatewayRequest, AssembledProviderPayload } from '../gateway/gateway.types';
import type { PolicyDecision } from '../policy/policy.types';
import type { AiCapability } from '../capability';
import type { AdapterInvokeOutcome } from './adapter-outcome';

export interface AdapterInvokeInput {
  readonly ctx: GatewayContext;
  readonly policy: PolicyDecision;
  readonly payload: AssembledProviderPayload;
  readonly request: GatewayRequest;
  readonly onToken?: (token: string) => void;
}

export interface CapabilityAdapter {
  readonly capability: AiCapability;
  invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome>;
}

export interface AdapterDispatchRecord {
  readonly capability: AiCapability;
  readonly provider: string;
  readonly model: string;
}
