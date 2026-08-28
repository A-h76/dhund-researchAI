export interface EmailSendParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface EmailService {
  send(params: EmailSendParams, correlationId?: string): Promise<{ id: string }>;
}
