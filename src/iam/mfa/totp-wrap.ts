import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function wrapTotpSecret(secret: Uint8Array, key: Uint8Array): Uint8Array {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), iv);
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([iv, tag, encrypted]));
}

export function unwrapTotpSecret(ciphertext: Uint8Array, key: Uint8Array): Uint8Array {
  if (ciphertext.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('TOTP ciphertext is truncated');
  }
  const buffer = Buffer.from(ciphertext);
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(encrypted), decipher.final()]));
}
