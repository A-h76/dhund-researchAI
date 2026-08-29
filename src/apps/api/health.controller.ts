import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReadinessService } from '../../platform/config';

@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res() response: Response): Promise<void> {
    const isReady = await this.readiness.isReady();
    const body = { status: isReady ? 'ready' : 'unready' };
    response.status(isReady ? 200 : 503).json(body);
  }
}
