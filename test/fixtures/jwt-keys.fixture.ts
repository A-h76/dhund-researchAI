import { generateKeyPairSync } from 'node:crypto';

export function generateTestJwtConfig(): { privateKey: string; kid: string } {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    kid: 'test-ed25519',
  };
}

export function jwtSecretRecord(): {
  AUTH_JWT_PRIVATE_KEY: string;
  AUTH_JWT_KID: string;
} {
  const jwt = generateTestJwtConfig();
  return {
    AUTH_JWT_PRIVATE_KEY: jwt.privateKey,
    AUTH_JWT_KID: jwt.kid,
  };
}
