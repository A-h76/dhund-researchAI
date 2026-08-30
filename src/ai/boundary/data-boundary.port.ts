import type { GatewayContext, GatewayRequest } from '../gateway/gateway.types';

export interface IDataBoundaryCheck {
  assertAllowed(ctx: GatewayContext, request: GatewayRequest): Promise<void>;
}

export interface BoundaryInvocationRecord {
  readonly capability: GatewayRequest['capability'];
  readonly correlationId: string;
}
