import type { GatewayContext, GatewayRequest, GatewayResult } from './gateway.types';

export interface IGatewayService {
  execute(ctx: GatewayContext, request: GatewayRequest): Promise<GatewayResult>;
}
