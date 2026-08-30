import { InvalidJobPayloadError, assertValidJobPayload } from '../logging/job-payload';
import { isQueueName, type QueueName } from './queue-names';
import { getQueuePolicy } from './queue-registry';

function readField(payload: Record<string, unknown>, field: string): unknown {
  if (field === 'identifier') {
    const identifier = payload.identifier;
    if (typeof identifier !== 'object' || identifier === null || Array.isArray(identifier)) {
      throw new InvalidJobPayloadError('Job payload is missing identifier object');
    }
    const scheme = (identifier as Record<string, unknown>).scheme;
    const value = (identifier as Record<string, unknown>).value;
    if (typeof scheme !== 'string' || scheme.length === 0) {
      throw new InvalidJobPayloadError('Job payload identifier.scheme is required');
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new InvalidJobPayloadError('Job payload identifier.value is required');
    }
    return identifier;
  }

  const value = payload[field];
  if (value === undefined || value === null) {
    throw new InvalidJobPayloadError(`Job payload is missing required field "${field}"`);
  }

  if (typeof value === 'string' && value.length === 0) {
    throw new InvalidJobPayloadError(`Job payload field "${field}" must be non-empty`);
  }

  if (field === 'connectorIds' && !Array.isArray(value)) {
    throw new InvalidJobPayloadError('Job payload connectorIds must be an array');
  }

  if (field === 'scope' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    throw new InvalidJobPayloadError('Job payload scope must be an object');
  }

  return value;
}

export function assertValidQueuePayload(
  queueName: string,
  payload: unknown,
): asserts payload is Record<string, unknown> {
  if (!isQueueName(queueName)) {
    throw new InvalidJobPayloadError(`Unknown queue "${queueName}"`);
  }

  assertValidJobPayload(payload);
  const record = payload as unknown as Record<string, unknown>;
  const policy = getQueuePolicy(queueName);

  for (const field of policy.requiredPayloadFields) {
    if (field === 'correlationId' || field === 'orgId') {
      continue;
    }
    readField(record, field);
  }
}

export function assertValidQueueJobPayload(
  queueName: QueueName,
  payload: unknown,
): asserts payload is Record<string, unknown> {
  assertValidQueuePayload(queueName, payload);
}
