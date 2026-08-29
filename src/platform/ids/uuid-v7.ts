import { randomBytes } from 'node:crypto';

const UUID_STRING_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GAP-PK-01: single sanctioned application ID source.
 * Generates RFC 9562 UUIDv7. Never use crypto.randomUUID() (v4).
 *
 * Do NOT extract the embedded timestamp for created_at / audit / ordering
 * of business time — use an explicit TIMESTAMPTZ created_at column.
 */
export function generateId(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());

  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  // version 7 (0111)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // RFC variant 10xx
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(bytes);
}

export function isUuid(value: string): boolean {
  return UUID_STRING_RE.test(value);
}

export function uuidVersion(value: string): number | null {
  if (!isUuid(value)) {
    return null;
  }

  return Number.parseInt(value.charAt(14), 16);
}

export function assertUuidV7(value: string): void {
  const version = uuidVersion(value);
  if (version !== 7) {
    throw new Error(`Expected UUIDv7, got version ${String(version)}`);
  }
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
