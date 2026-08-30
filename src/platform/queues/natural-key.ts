import { InvalidJobPayloadError } from '../logging/job-payload';
import type { QueueName } from './queue-names';
import { getQueuePolicy } from './queue-registry';
import { canonicalJson } from './canonical-json';

function readPath(payload: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = payload;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function buildNaturalKeyRecord(
  queueName: QueueName,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const policy = getQueuePolicy(queueName);
  const naturalKey: Record<string, unknown> = { queue: queueName };

  for (const field of policy.naturalKeyFields) {
    if (field === 'ocr') {
      naturalKey.ocr = 'ocr';
      continue;
    }

    const value = readPath(payload, field);
    if (value === undefined || value === null || value === '') {
      throw new InvalidJobPayloadError(
        `Job payload is missing natural key field "${field}" for queue "${queueName}"`,
      );
    }
    naturalKey[field.replace(/\./g, '_')] = value;
  }

  if (queueName === 'embed-backfill') {
    naturalKey.scope = canonicalJson(payload.scope);
  }

  if (queueName === 'discovery-search') {
    const connectorIds = payload.connectorIds;
    if (!Array.isArray(connectorIds)) {
      throw new InvalidJobPayloadError(
        'Job payload is missing natural key field "connectorIds" for queue "discovery-search"',
      );
    }
    naturalKey.connectorIdsHash = canonicalJson([...connectorIds].sort());
  }

  return naturalKey;
}

export function extractNaturalKey(
  queueName: QueueName,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return buildNaturalKeyRecord(queueName, payload);
}
