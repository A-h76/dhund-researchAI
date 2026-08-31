import {
  EVENT_CATALOG,
  EVENT_CATALOG_DOMAINS,
  getCatalogEvent,
  listCatalogEventTypes,
} from '../../src/platform/events/catalog';
import {
  assertCompatibilityWindow,
  findSameVersionBreaks,
} from '../../src/platform/events/schema/compatibility';
import { field, type EventVersionSchema } from '../../src/platform/events/schema/types';
import { FORBIDDEN_ENVELOPE_FIELDS } from '../../src/platform/events/envelope';

describe('event catalog + schemaVersion (DHB-43 / GAP-EVENT-VER-01)', () => {
  it('covers every Phase 5 §4 domain', () => {
    const domains = new Set(EVENT_CATALOG.map((entry) => entry.domain));
    for (const domain of EVENT_CATALOG_DOMAINS) {
      expect(domains.has(domain)).toBe(true);
    }
  });

  it('lists a non-empty catalog of event types', () => {
    expect(listCatalogEventTypes().length).toBeGreaterThan(10);
  });

  it('forbids causationId and traceId on the v1 envelope', () => {
    expect(FORBIDDEN_ENVELOPE_FIELDS).toEqual(['causationId', 'traceId']);
  });

  it('fails the contract when a payload field is removed at the same schemaVersion', () => {
    const baseline = [
      field('orgId', 'string'),
      field('userId', 'string'),
      field('email', 'string'),
    ];
    const candidate = [field('orgId', 'string'), field('userId', 'string')];
    const breaks = findSameVersionBreaks(baseline, candidate);
    expect(breaks.some((msg) => msg.includes('Removed field "email"'))).toBe(true);
  });

  it('fails the contract when a payload field is retyped at the same schemaVersion', () => {
    const baseline = [field('amountMicros', 'number')];
    const candidate = [field('amountMicros', 'string')];
    const breaks = findSameVersionBreaks(baseline, candidate);
    expect(breaks.some((msg) => msg.includes('Retyped field "amountMicros"'))).toBe(true);
  });

  it('validates both versions during a compatibility window', () => {
    const versions: readonly EventVersionSchema[] = [
      {
        schemaVersion: 1,
        fields: [field('orgId', 'string'), field('userId', 'string')],
      },
      {
        schemaVersion: 2,
        fields: [
          field('orgId', 'string'),
          field('userId', 'string'),
          field('locale', 'string', false),
        ],
      },
    ];

    assertCompatibilityWindow(versions, {
      1: { orgId: 'org-1', userId: 'user-1' },
      2: { orgId: 'org-1', userId: 'user-1', locale: 'en' },
    });
  });

  it('keeps catalog entries self-consistent (currentVersion present)', () => {
    for (const entry of EVENT_CATALOG) {
      const current = entry.versions.find((v) => v.schemaVersion === entry.currentVersion);
      expect(current).toBeDefined();
      expect(getCatalogEvent(entry.eventType)?.eventType).toBe(entry.eventType);
    }
  });
});
