import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AdapterRegistry } from './adapters/adapter-registry';
import { NoopDataBoundary } from './boundary/noop-data-boundary';
import { GatewayService } from './gateway/gateway.service';
import { PolicyResolver } from './policy/policy-resolver';
import { PromptAssembler } from './policy/prompt-assembler';
import { DATA_BOUNDARY_CHECK, GATEWAY_SERVICE } from './tokens';

@Module({
  imports: [PlatformModule],
  providers: [
    PolicyResolver,
    PromptAssembler,
    AdapterRegistry,
    GatewayService,
    NoopDataBoundary,
    { provide: DATA_BOUNDARY_CHECK, useExisting: NoopDataBoundary },
    { provide: GATEWAY_SERVICE, useExisting: GatewayService },
  ],
  exports: [GATEWAY_SERVICE, DATA_BOUNDARY_CHECK, GatewayService],
})
export class AiModule {}
