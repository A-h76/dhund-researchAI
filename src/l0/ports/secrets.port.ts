export interface SecretsService {
  getSecret(name: string): string | undefined;
}
