import { Injectable } from '@nestjs/common';
import type {
  BoundaryInvocationRecord,
  IDataBoundaryCheck,
} from './data-boundary.port';
import type { GatewayContext, GatewayRequest } from '../gateway/gateway.types';

@Injectable()
export class NoopDataBoundary implements IDataBoundaryCheck {
  private readonly invocations: BoundaryInvocationRecord[] = [];

  async assertAllowed(ctx: GatewayContext, request: GatewayRequest): Promise<void> {
    this.invocations.push({
      capability: request.capability,
      correlationId: ctx.correlationId,
    });
  }

  getInvocations(): readonly BoundaryInvocationRecord[] {
    return [...this.invocations];
  }

  resetInvocations(): void {
    this.invocations.length = 0;
  }
}
