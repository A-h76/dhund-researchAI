import { randomUUID } from 'node:crypto';
import {
  assertUuidV7,
  generateId,
  isUuid,
  uuidVersion,
} from '../../src/platform/ids';

describe('UUIDv7 generateId (GAP-PK-01)', () => {
  it('generates valid UUIDs with version 7', () => {
    const id = generateId();
    expect(isUuid(id)).toBe(true);
    expect(uuidVersion(id)).toBe(7);
    expect(() => assertUuidV7(id)).not.toThrow();
  });

  it('does not produce version 4 IDs', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(uuidVersion(generateId())).toBe(7);
    }
  });

  it('rejects a v4 UUID in assertUuidV7', () => {
    const v4 = randomUUID();
    expect(uuidVersion(v4)).toBe(4);
    expect(() => assertUuidV7(v4)).toThrow(/Expected UUIDv7/);
  });

  it('produces approximately time-ordered lexical IDs', async () => {
    const first = generateId();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = generateId();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const third = generateId();

    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
    expect([first, second, third].every((id) => uuidVersion(id) === 7)).toBe(true);
  });

  it('repeated generation yields unique IDs', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateId()));
    expect(set.size).toBe(200);
  });
});
