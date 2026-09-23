/**
 * GAP-PLAN-01: entitlement is derived here, never stored, and never read from
 * a provider payload. Product has not named tiers or numeric caps. The map stays
 * empty on purpose. An unknown plan code degrades to the restrictive entitlement.
 * Do not add named tiers or any numeric cap until that decision lands.
 */
export type EntitlementKind = 'mapped' | 'restrictive';

export interface Entitlement {
  readonly kind: EntitlementKind;
  readonly planCode: string;
}

const PLAN_ENTITLEMENTS: Readonly<Record<string, Entitlement>> = {};

export function deriveEntitlement(planCode: string): Entitlement {
  const mapped = PLAN_ENTITLEMENTS[planCode];
  if (mapped !== undefined) {
    return mapped;
  }
  return { kind: 'restrictive', planCode };
}
