export const EMAIL_SERVICE = Symbol('EMAIL_SERVICE');

export interface EmailService {
  ping(): Promise<boolean>;
}
