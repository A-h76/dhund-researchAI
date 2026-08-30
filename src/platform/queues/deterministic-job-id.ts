import { createHash } from 'node:crypto';
import type { QueueName } from './queue-names';
import { canonicalJson } from './canonical-json';
import { extractNaturalKey } from './natural-key';

export function deriveJobId(
  queueName: QueueName,
  payload: Record<string, unknown>,
): string {
  const naturalKey = extractNaturalKey(queueName, payload);
  // BullMQ custom job IDs must not contain ':' — queue scope is in naturalKey.queue.
  return createHash('sha256').update(canonicalJson(naturalKey)).digest('hex');
}
