import { Controller, Get } from '@nestjs/common';

@Controller()
export class ApiRootController {
  @Get()
  root(): { status: string } {
    return { status: 'ok' };
  }
}
