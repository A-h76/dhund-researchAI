import type { GatewayContext, GatewayRequest, GatewayResult } from './gateway.types';

export interface GatewayExecuteOptions {
  /** Called for each streamed token. Generation is not cancelled if this throws. */
  readonly onToken?: (token: string) => void;
}

export interface IGatewayService {
  execute(
    ctx: GatewayContext,
    request: GatewayRequest,
    options?: GatewayExecuteOptions,
  ): Promise<GatewayResult>;
}
