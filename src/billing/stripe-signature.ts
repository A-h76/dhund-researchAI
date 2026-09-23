import { createHmac, timingSafeEqual } from 'node:crypto';

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export function signStripePayload(secret: string, payload: Buffer, timestampSec: number): string {
  const signed = `${timestampSec}.${payload.toString('utf8')}`;
  const digest = createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
  return `t=${timestampSec},v1=${digest}`;
}

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string | undefined,
  nowMs: number,
): boolean {
  if (header === undefined || secret === undefined || secret.length === 0) {
    return false;
  }

  const parsed = parseSignatureHeader(header);
  if (parsed === null) {
    return false;
  }

  const timestampSec = Number(parsed.timestamp);
  if (!Number.isInteger(timestampSec)) {
    return false;
  }
  const skew = Math.abs(Math.floor(nowMs / 1000) - timestampSec);
  if (skew > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const signed = `${parsed.timestamp}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return parsed.signatures.some((candidate) => {
    const actual = Buffer.from(candidate, 'utf8');
    if (actual.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(actual, expectedBuf);
  });
}

function parseSignatureHeader(
  header: string,
): { timestamp: string; signatures: string[] } | null {
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't' && value.length > 0) {
      timestamp = value;
    }
    if (key === 'v1' && value.length > 0) {
      signatures.push(value);
    }
  }
  if (timestamp === undefined || signatures.length === 0) {
    return null;
  }
  return { timestamp, signatures };
}
