import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function decodeBase32(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function generateTotp(
  secret: Uint8Array,
  nowMs = Date.now(),
  periodSeconds = TOTP_PERIOD_SECONDS,
): string {
  const counter = BigInt(Math.floor(nowMs / 1000 / periodSeconds));
  return hotp(secret, counter);
}

export function verifyTotp(
  secret: Uint8Array,
  code: string,
  nowMs = Date.now(),
  driftSteps = TOTP_DRIFT_STEPS,
): boolean {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }
  const counter = BigInt(Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS));
  for (let drift = -driftSteps; drift <= driftSteps; drift += 1) {
    const candidate = hotp(secret, counter + BigInt(drift));
    if (codesEqual(candidate, normalized)) {
      return true;
    }
  }
  return false;
}

export function otpauthUrl(account: string, secretBase32: string): string {
  const label = encodeURIComponent(`Dhund:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: 'Dhund',
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(secret: Uint8Array, counter: bigint): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(counter);
  const hmac = createHmac('sha1', Buffer.from(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const modulus = 10 ** TOTP_DIGITS;
  return String(binary % modulus).padStart(TOTP_DIGITS, '0');
}

function codesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
