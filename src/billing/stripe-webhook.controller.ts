import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly webhooks: StripeWebhookService) {}

  @Post('stripe')
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ received: true }> {
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const header = request.headers['stripe-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    await this.webhooks.receive({ rawBody, signature });
    return { received: true };
  }
}
