import { Controller, Get } from '@nestjs/common';
import { notFound } from '../../platform/errors/domain-error';
import { FeatureFlagsService } from '../../platform/config';

@Controller('capabilities')
export class CapabilityProbeController {
  constructor(private readonly featureFlags: FeatureFlagsService) {}

  @Get('research-runs')
  researchRuns(): { status: string } {
    if (!this.featureFlags.isEnabled('research_runs')) {
      throw notFound();
    }

    return { status: 'available' };
  }
}
