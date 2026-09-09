import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { BreachListPort, BreachListVerdict } from '../../ports/breach-list.port';

/** Short timeout: HIBP outage must not fail registration. */
export const HIBP_RANGE_TIMEOUT_MS = 400;
export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';

/**
 * Have I Been Pwned k-anonymity range API.
 * Only the SHA-1 prefix is sent. The password and full hash never leave the process.
 */
@Injectable()
export class HibpBreachListAdapter implements BreachListPort {
  timeoutMs = HIBP_RANGE_TIMEOUT_MS;

  async check(password: string): Promise<BreachListVerdict> {
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const response = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
        method: 'GET',
        headers: {
          'Add-Padding': 'true',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        return 'unavailable';
      }

      const body = await response.text();
      return rangeContainsSuffix(body, suffix) ? 'breached' : 'clear';
    } catch {
      return 'unavailable';
    }
  }
}

export function rangeContainsSuffix(body: string, suffix: string): boolean {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const candidate = line.split(':')[0]?.trim().toUpperCase();
    if (candidate === suffix) {
      return true;
    }
  }
  return false;
}
