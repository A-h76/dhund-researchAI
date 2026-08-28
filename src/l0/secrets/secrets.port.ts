export const SECRETS_SERVICE = Symbol('SECRETS_SERVICE');

export interface SecretsService {
  ping(): Promise<boolean>;
}
