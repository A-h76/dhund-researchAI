import { Inject, Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { L0OperationError } from '../../ports/errors';
import type { EmailSendParams, EmailService } from '../../ports/email.port';
import type { SecretsService } from '../../ports/secrets.port';
import { SECRETS_SERVICE } from '../../ports/tokens';

@Injectable()
export class ResendEmailAdapter implements EmailService {
  private client: Resend | null = null;

  constructor(@Inject(SECRETS_SERVICE) private readonly secrets: SecretsService) {}

  async send(params: EmailSendParams, correlationId?: string): Promise<{ id: string }> {
    void correlationId;
    const client = this.getClient();
    const from = params.from ?? this.secrets.getSecret('EMAIL_FROM') ?? 'onboarding@resend.dev';

    try {
      const result = await client.emails.send({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });

      if (result.error) {
        throw new L0OperationError(result.error.message);
      }

      if (!result.data?.id) {
        throw new L0OperationError('Email send returned no id');
      }

      return { id: result.data.id };
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }

      throw new L0OperationError('Email send failed', error);
    }
  }

  private getClient(): Resend {
    if (this.client) {
      return this.client;
    }

    const apiKey = this.secrets.getSecret('RESEND_API_KEY');
    if (!apiKey) {
      throw new L0OperationError('RESEND_API_KEY is not configured');
    }

    this.client = new Resend(apiKey);
    return this.client;
  }
}
