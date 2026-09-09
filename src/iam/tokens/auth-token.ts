import { createHash } from 'node:crypto';

export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
