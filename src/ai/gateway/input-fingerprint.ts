import { createHash } from 'node:crypto';
import type { GatewayRequest } from './gateway.types';

export function computeInputFingerprint(request: GatewayRequest): string {
  const serialized = stableSerialize(request);
  return createHash('sha256').update(serialized).digest('hex');
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}
